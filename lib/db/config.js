import { randomUUID } from 'crypto';
import { eq, and, or, isNull } from 'drizzle-orm';
import { getDb } from './index.js';
import { settings } from './schema.js';
import { encrypt, decrypt } from './crypto.js';
import { createOAuthToken } from './oauth-tokens.js';

// ─────────────────────────────────────────────────────────────────────────────
// Plain config (type: 'config')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a plain config value.
 * @param {string} key
 * @returns {string|null}
 */
export function getConfigValue(key) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/**
 * Set a plain config value (upsert: delete + insert).
 * @param {string} key
 * @param {string} value
 * @param {string} [userId]
 */
export function setConfigValue(key, value, userId) {
  const db = getDb();
  const now = Date.now();
  // Atomic upsert: delete + insert in one transaction so a concurrent reader
  // never observes the key missing between the two statements.
  db.transaction((tx) => {
    tx.delete(settings)
      .where(and(eq(settings.type, 'config'), eq(settings.key, key)))
      .run();
    tx.insert(settings)
      .values({
        id: randomUUID(),
        type: 'config',
        key,
        value: JSON.stringify(value),
        createdBy: userId || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

/**
 * Delete a plain config value.
 * @param {string} key
 */
export function deleteConfigValue(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, key)))
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Encrypted secrets (type: 'config_secret')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a decrypted secret value.
 * @param {string} key
 * @returns {string|null}
 */
export function getConfigSecret(key) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'config_secret'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  try {
    return decrypt(JSON.parse(row.value));
  } catch (err) {
    console.warn(`[config] failed to decrypt secret "${key}":`, err.message);
    return null;
  }
}

/**
 * Set an encrypted secret (upsert: delete + insert).
 * @param {string} key
 * @param {string} value - Plaintext value to encrypt
 * @param {string} [userId]
 */
export function setConfigSecret(key, value, userId) {
  const db = getDb();
  const now = Date.now();
  const encrypted = encrypt(value);
  // Atomic upsert: delete + insert in one transaction.
  db.transaction((tx) => {
    tx.delete(settings)
      .where(and(eq(settings.type, 'config_secret'), eq(settings.key, key)))
      .run();
    tx.insert(settings)
      .values({
        id: randomUUID(),
        type: 'config_secret',
        key,
        value: JSON.stringify(encrypted),
        createdBy: userId || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

/**
 * Delete an encrypted secret.
 * @param {string} key
 */
export function deleteConfigSecret(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'config_secret'), eq(settings.key, key)))
    .run();
}

/**
 * Get status (set/not-set + updatedAt) for multiple secret keys. Never returns values.
 * @param {string[]} keys
 * @returns {{ key: string, isSet: boolean, updatedAt: number|null }[]}
 */
export function getSecretStatus(keys) {
  const db = getDb();
  const rows = db
    .select({ key: settings.key, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.type, 'config_secret'))
    .all();
  const map = new Map(rows.map((r) => [r.key, r.updatedAt]));
  return keys.map((key) => ({
    key,
    isSet: map.has(key),
    updatedAt: map.get(key) || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom LLM providers (type: 'llm_provider')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all custom providers (API keys masked for UI).
 * @returns {{ key: string, name: string, baseUrl: string, models: string[], hasApiKey: boolean }[]}
 */
export function getCustomProviders() {
  const db = getDb();
  const rows = db
    .select()
    .from(settings)
    .where(eq(settings.type, 'llm_provider'))
    .all();
  return rows.map((row) => {
    let config;
    try {
      config = JSON.parse(decrypt(JSON.parse(row.value)));
    } catch (err) {
      console.warn(`[config] failed to decrypt provider "${row.key}":`, err.message);
      return null;
    }
    return {
      key: row.key,
      name: config.name,
      baseUrl: config.baseUrl,
      models: config.models || [],
      hasApiKey: !!config.apiKey,
    };
  }).filter(Boolean);
}

/**
 * Get a single custom provider with full (unmasked) API key — for runtime use.
 * @param {string} key
 * @returns {{ name: string, baseUrl: string, apiKey: string, models: string[] }|null}
 */
export function getCustomProvider(key) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'llm_provider'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  let config;
  try {
    config = JSON.parse(decrypt(JSON.parse(row.value)));
  } catch (err) {
    console.warn(`[config] failed to decrypt provider "${key}":`, err.message);
    return null;
  }
  if (!config.models) config.models = [];
  return config;
}

/**
 * Create or update a custom provider (encrypted JSON).
 * @param {string} key - Slug identifier (e.g. 'together-ai')
 * @param {{ name: string, baseUrl: string, apiKey?: string, models: string[] }} config
 * @param {string} [userId]
 */
export function setCustomProvider(key, config, userId) {
  const db = getDb();
  const now = Date.now();
  const encrypted = encrypt(JSON.stringify(config));
  // Atomic upsert: delete + insert in one transaction.
  db.transaction((tx) => {
    tx.delete(settings)
      .where(and(eq(settings.type, 'llm_provider'), eq(settings.key, key)))
      .run();
    tx.insert(settings)
      .values({
        id: randomUUID(),
        type: 'llm_provider',
        key,
        value: JSON.stringify(encrypted),
        createdBy: userId || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

/**
 * Delete a custom provider.
 * @param {string} key
 */
export function deleteCustomProvider(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'llm_provider'), eq(settings.key, key)))
    .run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent job secrets (type: 'agent_job_secret')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set an agent job secret (upsert, encrypted).
 * @param {string} key
 * @param {string} value - Plaintext value to encrypt
 * @param {string} [userId]
 * @param {{ ownerId?: string|null }} [opts] - When `ownerId` is provided the
 *   secret is scoped to that owner (only that job/user, plus admins, may read
 *   it). Omitted/undefined keeps the existing global behavior (readable by any
 *   agent job). Note: an upsert that omits ownerId preserves the prior row's
 *   ownerId rather than silently clearing it.
 */
export function setAgentJobSecret(key, value, userId, opts) {
  const db = getDb();
  const now = Date.now();
  const encrypted = encrypt(value);

  // Preserve the existing owner on upsert unless an explicit ownerId is given.
  const existing = db
    .select({ ownerId: settings.ownerId })
    .from(settings)
    .where(and(eq(settings.type, 'agent_job_secret'), eq(settings.key, key)))
    .get();
  const ownerId =
    opts && 'ownerId' in opts ? (opts.ownerId || null) : (existing ? existing.ownerId : null);

  db.transaction((tx) => {
    tx.delete(settings)
      .where(and(eq(settings.type, 'agent_job_secret'), eq(settings.key, key)))
      .run();
    tx.insert(settings)
      .values({
        id: randomUUID(),
        type: 'agent_job_secret',
        key,
        value: JSON.stringify(encrypted),
        ownerId,
        createdBy: userId || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}

/**
 * Get OAuth credentials stored with an agent job secret.
 * Returns { clientId, clientSecret, tokenUrl } if the secret is oauth2, null otherwise.
 * @param {string} key
 */
export function getAgentJobSecretOAuthCredentials(key) {
  const db = getDb();
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.type, 'agent_job_secret'), eq(settings.key, key)))
    .get();
  if (!row) return null;
  try {
    const decrypted = decrypt(JSON.parse(row.value));
    const parsed = JSON.parse(decrypted);
    if (parsed.type === 'oauth2' && parsed.clientId && parsed.clientSecret) {
      return { clientId: parsed.clientId, clientSecret: parsed.clientSecret, tokenUrl: parsed.tokenUrl };
    }
  } catch {}
  return null;
}

/**
 * Delete an agent job secret.
 * @param {string} key
 */
export function deleteAgentJobSecret(key) {
  const db = getDb();
  db.delete(settings)
    .where(and(eq(settings.type, 'agent_job_secret'), eq(settings.key, key)))
    .run();
}

/**
 * Build the WHERE clause that scopes an agent_job_secret query to an owner.
 * When `ownerId` is null/undefined the caller is treated as global/admin and
 * sees every secret (back-compat). When an `ownerId` is supplied, only globally
 * owned secrets (ownerId IS NULL) and secrets owned by that id are visible.
 * @param {string|null} [ownerId]
 */
function agentJobSecretScope(ownerId) {
  const base = eq(settings.type, 'agent_job_secret');
  if (!ownerId) return base;
  return and(base, or(isNull(settings.ownerId), eq(settings.ownerId, ownerId)));
}

/**
 * List agent job secrets (metadata only, never values).
 * @param {string|null} [ownerId] - Optional owner scope. Omitted = all secrets
 *   (admin/global). When set, only global + owner-owned secrets are returned.
 * @returns {{ key: string, isSet: boolean, updatedAt: number }[]}
 */
export function listAgentJobSecrets(ownerId) {
  const db = getDb();
  const rows = db
    .select({ key: settings.key, value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(agentJobSecretScope(ownerId))
    .all();
  return rows.map((r) => {
    let secretType = 'manual';
    try {
      const decrypted = decrypt(JSON.parse(r.value));
      try {
        const parsed = JSON.parse(decrypted);
        if (parsed.type === 'oauth2' || parsed.type === 'oauth_token') {
          secretType = parsed.type;
        }
      } catch {}
    } catch {}
    return { key: r.key, isSet: true, updatedAt: r.updatedAt, secretType };
  });
}

/**
 * Get all agent job secrets decrypted (for runtime injection only).
 * @returns {{ key: string, value: string }[]}
 */
export function getAllAgentJobSecrets() {
  const db = getDb();
  const rows = db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.type, 'agent_job_secret'))
    .all();
  return rows.map((r) => {
    try {
      const decrypted = decrypt(JSON.parse(r.value));
      try {
        const parsed = JSON.parse(decrypted);
        if (parsed.type === 'oauth2' || parsed.type === 'oauth_token') {
          return { key: r.key, value: null };
        }
      } catch {}
      return { key: r.key, value: decrypted };
    } catch (err) {
      console.warn(`[secrets] failed to decrypt agent secret "${r.key}":`, err.message);
      return null;
    }
  }).filter(Boolean);
}

/**
 * Get a single agent job secret, decrypted. Returns the raw stored string (may be JSON).
 * @param {string} key
 * @param {string|null} [ownerId] - Optional owner scope. Omitted = unscoped
 *   (admin/global). When set, the secret is only returned if it is global
 *   (ownerId IS NULL) or owned by that id; otherwise returns null (not found).
 * @returns {string|null}
 */
export function getAgentJobSecretRaw(key, ownerId) {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(and(agentJobSecretScope(ownerId), eq(settings.key, key)))
    .get();
  if (!row) return null;
  try { return decrypt(JSON.parse(row.value)); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration: import env vars to DB on first run
// ─────────────────────────────────────────────────────────────────────────────

// Secrets to migrate from process.env → config_secret
// Kept in sync with SECRET_KEYS in lib/config.js (plus CLAUDE_CODE_OAUTH_TOKEN,
// which is migrated via the OAuth-token wrapper rather than as a plain secret).
const MIGRATE_SECRETS = [
  'GH_TOKEN',
  'GH_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'DEEPSEEK_API_KEY',
  'MINIMAX_API_KEY',
  'MISTRAL_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'ASSEMBLYAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
];

// Plain config to migrate from process.env → config
// Kept in sync with CONFIG_KEYS in lib/config.js.
const MIGRATE_CONFIG = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_MAX_TOKENS',
  'AGENT_BACKEND',
  'CUSTOM_OPENAI_BASE_URL',
  'UPGRADE_INCLUDE_BETA',
  'CODING_AGENT',
  'CODING_AGENT_CLAUDE_CODE_ENABLED',
  'CODING_AGENT_CLAUDE_CODE_AUTH',
  'CODING_AGENT_CLAUDE_CODE_BACKEND',
  'CODING_AGENT_CLAUDE_CODE_MODEL',
  'CODING_AGENT_PI_ENABLED',
  'CODING_AGENT_PI_PROVIDER',
  'CODING_AGENT_PI_MODEL',
  'CODING_AGENT_GEMINI_CLI_ENABLED',
  'CODING_AGENT_GEMINI_CLI_MODEL',
  'CODING_AGENT_CODEX_CLI_ENABLED',
  'CODING_AGENT_CODEX_CLI_AUTH',
  'CODING_AGENT_CODEX_CLI_MODEL',
  'CODING_AGENT_OPENCODE_ENABLED',
  'CODING_AGENT_OPENCODE_PROVIDER',
  'CODING_AGENT_OPENCODE_MODEL',
  'CODING_AGENT_KIMI_CLI_ENABLED',
  'CODING_AGENT_KIMI_CLI_PROVIDER',
  'CODING_AGENT_KIMI_CLI_MODEL',
  'AGENT_MODE_BRANCH',
  'CODE_MODE_BRANCH',
  'AGENT_MODE_GIT_ACTION',
  'CODE_MODE_GIT_ACTION',
  'AGENT_MODE_AUTO_RUN',
  'CODE_MODE_AUTO_RUN',
  'TELEGRAM_WEBHOOK_URL',
];

/**
 * One-time migration: import env vars into DB if no config entries exist yet.
 * Idempotent — checks for any existing config/config_secret rows first.
 */
export function migrateEnvToDb() {
  const db = getDb();

  // Check if migration already happened (any config or config_secret row exists)
  const existing = db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.type, 'config'))
    .limit(1)
    .get();
  const existingSecret = db
    .select({ id: settings.id })
    .from(settings)
    .where(eq(settings.type, 'config_secret'))
    .limit(1)
    .get();

  if (existing || existingSecret) return; // Already migrated

  let migrated = 0;

  for (const key of MIGRATE_SECRETS) {
    const value = process.env[key];
    if (value) {
      if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
        // OAuth tokens use {name, token} wrapper format for multi-token support
        createOAuthToken('claudeCode', 'OAuth Token', value, 'migration');
      } else {
        setConfigSecret(key, value, 'migration');
      }
      migrated++;
    }
  }

  for (const key of MIGRATE_CONFIG) {
    const value = process.env[key];
    if (value) {
      setConfigValue(key, value, 'migration');
      migrated++;
    }
  }

  // Migrate custom provider from OPENAI_BASE_URL + CUSTOM_API_KEY
  if (process.env.LLM_PROVIDER === 'custom' && (process.env.CUSTOM_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL)) {
    setCustomProvider('custom', {
      name: 'Custom',
      baseUrl: process.env.CUSTOM_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
      apiKey: process.env.CUSTOM_API_KEY || '',
      models: process.env.LLM_MODEL ? [process.env.LLM_MODEL] : [],
    }, 'migration');
    migrated++;
  }

  if (migrated > 0) {
    console.log(`Migrated ${migrated} config values from .env to database`);
  }

  // Rename OPENAI_BASE_URL → CUSTOM_OPENAI_BASE_URL (added in unified coding agent release)
  migrateConfigKey('OPENAI_BASE_URL', 'CUSTOM_OPENAI_BASE_URL');
}

/**
 * Rename a config key in the DB if the old key exists and the new key does not.
 * @param {string} oldKey
 * @param {string} newKey
 */
function migrateConfigKey(oldKey, newKey) {
  const db = getDb();
  const oldRow = db
    .select()
    .from(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, oldKey)))
    .get();
  if (!oldRow) return;
  const newRow = db
    .select({ id: settings.id })
    .from(settings)
    .where(and(eq(settings.type, 'config'), eq(settings.key, newKey)))
    .get();
  if (newRow) {
    // New key already exists, just delete the old one
    db.delete(settings).where(eq(settings.id, oldRow.id)).run();
  } else {
    // Rename by inserting new + deleting old
    const now = Date.now();
    db.insert(settings)
      .values({
        id: randomUUID(),
        type: 'config',
        key: newKey,
        value: oldRow.value,
        createdBy: oldRow.createdBy,
        createdAt: oldRow.createdAt,
        updatedAt: now,
      })
      .run();
    db.delete(settings).where(eq(settings.id, oldRow.id)).run();
  }
  console.log(`Migrated config key ${oldKey} → ${newKey}`);
}
