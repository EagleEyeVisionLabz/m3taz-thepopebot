import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { settings } from './db/schema.js';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

async function cleanExpiredAgentJobKeys() {
  try {
    const db = getDb();
    const rows = db
      .select({ id: settings.id, key: settings.key, lastUsedAt: settings.lastUsedAt, createdAt: settings.createdAt })
      .from(settings)
      .where(eq(settings.type, 'agent_job_api_key'))
      .all();

    // Split into SDK keys (no container) vs container-backed keys.
    // Match an anchored prefix rather than a substring so container names
    // that merely contain 'sdk' aren't misclassified as SDK keys.
    const SDK_KEY_PREFIX = 'claude-code-sdk-';
    const sdkRows = rows.filter(r => r.key.startsWith(SDK_KEY_PREFIX));
    const containerRows = rows.filter(r => !r.key.startsWith(SDK_KEY_PREFIX));

    let deleted = 0;

    // SDK keys: delete any older than 1 hour (no container to inspect)
    const sdkCutoff = Date.now() - ONE_HOUR;
    for (const r of sdkRows) {
      const age = r.lastUsedAt !== null ? r.lastUsedAt : r.createdAt;
      if (age < sdkCutoff) {
        db.delete(settings).where(eq(settings.id, r.id)).run();
        deleted++;
      }
    }

    // Container-backed keys: existing logic — 24h expiry + container inspect
    const containerCutoff = Date.now() - TWENTY_FOUR_HOURS;
    const candidates = containerRows.filter(r =>
      (r.lastUsedAt !== null ? r.lastUsedAt : r.createdAt) < containerCutoff
    );

    if (candidates.length > 0) {
      const { inspectContainer } = await import('./tools/docker.js');
      for (const r of candidates) {
        try {
          const info = await inspectContainer(r.key);
          if (!info) {
            db.delete(settings).where(eq(settings.id, r.id)).run();
            deleted++;
          }
        } catch (err) {
          // inspectContainer throws on non-404 errors (e.g. 500, transport).
          // Treat as 'unknown' and keep the key this run rather than risk
          // revoking a still-running container's credential; continue so one
          // bad entry doesn't block cleanup of the remaining candidates.
          console.error(`[maintenance] inspectContainer failed for ${r.key}, skipping:`, err);
        }
      }
    }

    if (deleted > 0) {
      console.log(`[maintenance] Deleted ${deleted} expired agent job key(s)`);
    } else {
      console.log(`[maintenance] No expired agent job keys (${rows.length} active)`);
    }
  } catch (err) {
    console.error('[maintenance] cleanExpiredAgentJobKeys failed:', err);
  }
}

async function runMaintenance() {
  console.log('[maintenance] Running maintenance...');
  await cleanExpiredAgentJobKeys();
}

export function startMaintenanceCron() {
  cron.schedule('0 * * * *', runMaintenance);
}
