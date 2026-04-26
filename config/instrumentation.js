/**
 * Next.js instrumentation hook for thepopebot.
 * This file is loaded by Next.js on server start when instrumentationHook is enabled.
 *
 * Users should create an instrumentation.js in their project root that imports this:
 *
 *   export { register } from 'thepopebot/instrumentation';
 *
 * Or they can re-export and add their own logic.
 */

let initialized = false;

export async function register() {
  // Only run on the server, and only once
  if (typeof window !== 'undefined' || initialized) return;
  initialized = true;

  // Load .env from project root
  const dotenv = await import('dotenv');
  dotenv.config();

  // Skip database init and cron scheduling during `next build` —
  // these are runtime-only concerns that keep the event loop alive
  // and can cause build output corruption.
  if (process.argv.includes('build')) return;

  // Set AUTH_URL from APP_URL so NextAuth redirects to the correct host (e.g., on sign-out)
  if (process.env.APP_URL && !process.env.AUTH_URL) {
    process.env.AUTH_URL = process.env.APP_URL;
  }

  // Validate AUTH_SECRET is set (required by Auth.js for session encryption)
  if (!process.env.AUTH_SECRET) {
    console.error('\n  ERROR: AUTH_SECRET is not set in your .env file.');
    console.error('  This is required for session encryption.');
    console.error('  Run "npm run setup" to generate it automatically, or add manually:');
    console.error('  openssl rand -base64 32\n');
    throw new Error('AUTH_SECRET environment variable is required');
  }

  // Initialize auth database
  const { initDatabase } = await import('../lib/db/index.js');
  initDatabase();

  // Migrate env vars to DB on first run (idempotent)
  try {
    const { migrateEnvToDb } = await import('../lib/db/config.js');
    migrateEnvToDb();
  } catch (err) {
    console.warn('Config migration:', err.message);
  }

  // Start cron scheduler
  const { loadCrons, reloadCrons } = await import('../lib/cron.js');
  loadCrons();

  // Start built-in crons (version check)
  const { startBuiltinCrons, setUpdateAvailable } = await import('../lib/cron.js');
  startBuiltinCrons();

  // Warm in-memory flag from DB (covers the window before the async cron fetch completes)
  try {
    const { getAvailableVersion } = await import('../lib/db/update-check.js');
    const stored = getAvailableVersion();
    if (stored) setUpdateAvailable(stored);
  } catch {}

  // Start cluster worker runtime (crons + webhook registration)
  const { startClusterRuntime } = await import('../lib/cluster/runtime.js');
  startClusterRuntime();

  // Start internal maintenance cron (cleanup orphaned agent job keys, etc.)
  const { startMaintenanceCron } = await import('../lib/maintenance.js');
  startMaintenanceCron();

  // Watch config files for hot reload (avoids full pm2 restart on git pull)
  const { reloadTriggers } = await import('../lib/triggers.js');
  const { default: chokidar } = await import('chokidar');
  const { PROJECT_ROOT } = await import('../lib/paths.js');
  const path = await import('path');

  const cronsPath = path.join(PROJECT_ROOT, 'agent-job/CRONS.json');
  const triggersPath = path.join(PROJECT_ROOT, 'event-handler/TRIGGERS.json');

  const watcher = chokidar.watch([cronsPath, triggersPath], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('change', (filePath) => {
    if (filePath.endsWith('CRONS.json')) {
      console.log('[config watch] CRONS.json changed, reloading...');
      reloadCrons();
    } else if (filePath.endsWith('TRIGGERS.json')) {
      console.log('[config watch] TRIGGERS.json changed, reloading...');
      reloadTriggers();
    }
  });

  watcher.on('error', (err) => {
    console.error('[config watch] Watcher error:', err.message);
  });

  console.log('thepopebot initialized');
}
