import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from './index.js';
import { settings } from './schema.js';

const KEY_PREFIX = 'tpb_';

/**
 * Generate a new API key: tpb_ + 64 hex chars (32 random bytes).
 * @returns {string}
 */
export function generateApiKey() {
  return KEY_PREFIX + randomBytes(32).toString('hex');
}

/**
 * Hash an API key using SHA-256.
 * @param {string} key - Raw API key
 * @returns {string} Hex digest
 */
export function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Create a new named API key.
 * @param {string} name - Human-readable name for the key
 * @param {string} createdBy - User ID
 * @returns {{ key: string, record: object }}
 */
export function createApiKeyRecord(name, createdBy) {
  const db = getDb();

  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const keyPrefix = key.slice(0, 8); // "tpb_" + first 4 hex chars
  const now = Date.now();

  const record = {
    id: randomUUID(),
    type: 'api_key',
    key: randomUUID(), // unique identifier per key
    value: JSON.stringify({ name, key_prefix: keyPrefix, key_hash: keyHash }),
    keyHash, // indexed column — drives the fast verify path
    createdBy,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(settings).values(record).run();

  return {
    key,
    record: {
      id: record.id,
      name,
      keyPrefix,
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

/**
 * List all API keys (metadata only, no hashes).
 * @returns {object[]}
 */
export function listApiKeys() {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(eq(settings.type, 'api_key'))
    .all();

  return rows.map((row) => {
    const parsed = JSON.parse(row.value);
    return {
      id: row.id,
      name: parsed.name || 'API Key',
      keyPrefix: parsed.key_prefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  });
}

/**
 * Get the current API key metadata (no hash). Returns first key for backwards compat.
 * @returns {object|null}
 */
export function getApiKey() {
  const keys = listApiKeys();
  return keys.length > 0 ? keys[0] : null;
}

/**
 * Delete a specific API key by ID.
 * @param {string} id - Record ID
 */
export function deleteApiKeyById(id) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.id, id), eq(settings.type, 'api_key')))
    .run();
}

/**
 * Delete all API keys (backwards compat).
 */
export function deleteApiKey() {
  const db = getDb();
  db.delete(settings).where(eq(settings.type, 'api_key')).run();
}

/**
 * Verify a raw API key against stored hashes.
 * Queries the database directly on each call (SQLite is in-process, no caching needed).
 * @param {string} rawKey - Raw API key from request header
 * @returns {object|null} Record if valid, null otherwise
 */
export function verifyApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashApiKey(rawKey);
  const db = getDb();

  // Fast path: single indexed lookup on the dedicated key_hash column.
  // Restrict to the two API-key row types so a collision on another row type
  // (which never populates key_hash) can't match.
  const indexed = db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.keyHash, keyHash),
        inArray(settings.type, ['api_key', 'agent_job_api_key'])
      )
    )
    .get();

  const b = Buffer.from(keyHash, 'hex');

  if (indexed && typeof indexed.keyHash === 'string') {
    // Constant-time confirm even though the index already matched.
    const a = Buffer.from(indexed.keyHash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return finalizeVerifiedKey(db, indexed);
    }
  }

  // Fallback path: legacy rows created before the key_hash column existed store
  // the hash only inside the JSON `value`. Scan those (no indexed key_hash).
  const rows = [
    ...db.select().from(settings).where(eq(settings.type, 'api_key')).all(),
    ...db.select().from(settings).where(eq(settings.type, 'agent_job_api_key')).all(),
  ].filter((row) => !row.keyHash); // already covered by the indexed path

  for (const row of rows) {
    let parsed;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (typeof parsed?.key_hash !== 'string') continue;
    const a = Buffer.from(parsed.key_hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return finalizeVerifiedKey(db, row, parsed.key_hash);
    }
  }

  return null;
}

/**
 * Stamp last_used_at and return the public record shape for a verified key row.
 * @param {object} db
 * @param {object} row - settings row
 * @param {string} [legacyHash] - hash from JSON value when the column is empty
 */
function finalizeVerifiedKey(db, row, legacyHash) {
  try {
    const now = Date.now();
    db.update(settings)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(eq(settings.id, row.id))
      .run();
  } catch (err) {
    console.error('[api-keys] Failed to update last_used_at:', err.message);
  }
  return {
    id: row.id,
    keyHash: row.keyHash || legacyHash || null,
    type: row.type,
    ownerId: row.ownerId || null,
  };
}

/**
 * Create a per-container API key for agent secret access.
 * Stored as type 'agent_job_api_key' with the container name in the key column.
 * @param {string} containerName - Docker container name (used for cleanup)
 * @param {string} [ownerId] - Optional owning user/job id. When set, the key is
 *   scoped to secrets owned by / granted to that owner (see lib/db/config.js).
 *   Omitted (null) keeps the historical global behavior for back-compat.
 * @returns {{ key: string }} The raw API key to inject into the container
 */
export function createAgentJobApiKey(containerName, ownerId = null) {
  const db = getDb();
  const key = generateApiKey();
  const keyHash = hashApiKey(key);
  const now = Date.now();
  db.insert(settings).values({
    id: randomUUID(),
    type: 'agent_job_api_key',
    key: containerName,
    value: JSON.stringify({ key_hash: keyHash }),
    keyHash, // indexed column — drives the fast verify path
    ownerId: ownerId || null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return { key };
}

/**
 * Backfill lastUsedAt column from JSON value for existing api_key rows.
 * Idempotent — only processes rows that still have last_used_at in JSON.
 * Called from initDatabase().
 */
export function backfillLastUsedAt() {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(eq(settings.type, 'api_key'))
    .all();

  for (const row of rows) {
    let parsed;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!('last_used_at' in parsed)) continue;

    const lastUsedAt = parsed.last_used_at;
    delete parsed.last_used_at;

    db.update(settings)
      .set({
        value: JSON.stringify(parsed),
        lastUsedAt: lastUsedAt || null,
      })
      .where(eq(settings.id, row.id))
      .run();
  }
}
