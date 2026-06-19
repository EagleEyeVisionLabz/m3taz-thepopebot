import cron from 'node-cron';
import { getAllRolesWithTriggers, getRoleWithCluster } from '../db/clusters.js';
import { verifyApiKey } from '../db/api-keys.js';
import { acquireAndRunRole } from './execute.js';
import path from 'path';

// ── In-memory state ──────────────────────────────────────────────
let _cronTasks = [];      // [{ roleId, task }]
let _fileWatchers = [];   // [{ roleId, watcher }]

// ── Boot & Reload ────────────────────────────────────────────────

/**
 * Start the cluster runtime — schedule crons and file watchers.
 * Called once at boot from instrumentation.js.
 */
export function startClusterRuntime() {
  try {
    loadRoles();
    console.log('[cluster] Runtime started');
  } catch (err) {
    console.error('[cluster] Failed to start runtime:', err.message);
  }
}

/**
 * Stop all crons, close file watchers, and re-load from DB.
 * Called when roles/triggers are updated via UI.
 */
export function reloadClusterRuntime() {
  for (const { task } of _cronTasks) {
    task.stop();
  }
  _cronTasks = [];

  for (const { watcher } of _fileWatchers) {
    watcher.close();
  }
  _fileWatchers = [];

  try {
    loadRoles();
    console.log('[cluster] Runtime reloaded');
  } catch (err) {
    console.error('[cluster] Failed to reload runtime:', err.message);
  }
}

/**
 * Load all roles with trigger configs from DB and set up crons/file watchers.
 * Webhooks are always-on — no registration needed.
 */
function loadRoles() {
  const roles = getAllRolesWithTriggers();
  let cronCount = 0;
  let fileWatchCount = 0;

  for (const role of roles) {
    const config = role.triggerConfig;
    if (!config) continue;

    // Cron trigger — direct execution
    if (config.cron && config.cron.enabled && config.cron.schedule) {
      const schedule = config.cron.schedule;
      if (!cron.validate(schedule)) {
        console.warn(`[cluster] Invalid cron schedule for role ${role.id}: ${schedule}`);
        continue;
      }
      const task = cron.schedule(schedule, async () => {
        try {
          const result = await acquireAndRunRole(role.id, null, { type: 'cron', schedule });
          if (!result.allowed) return;
        } catch (err) {
          console.error(`[cluster] Cron execution failed for role ${role.id}:`, err.message);
        }
      });
      _cronTasks.push({ roleId: role.id, task });
      cronCount++;
    }

    // File watch trigger — direct execution.
    // setupFileWatch is async; attach a .catch so a malformed file_watch config
    // (bad paths, chokidar failure) surfaces as a logged error instead of an
    // unhandled promise rejection that escapes loadRoles' synchronous try/catch.
    if (config.file_watch && config.file_watch.enabled && config.file_watch.paths) {
      setupFileWatch(role).catch((err) => {
        console.error(`[cluster] File watch setup failed for role ${role.id}:`, err.message);
      });
      fileWatchCount++;
    }
  }

  if (cronCount > 0 || fileWatchCount > 0) {
    console.log(`[cluster] Loaded ${cronCount} cron(s), ${fileWatchCount} file watcher(s)`);
  }
}

/**
 * Set up a chokidar file watcher for a role.
 */
async function setupFileWatch(role) {
  let chokidar;
  try {
    chokidar = await import('chokidar');
  } catch {
    console.warn(`[cluster] chokidar not installed, skipping file watch for role ${role.id}`);
    return;
  }

  const roleData = getRoleWithCluster(role.id);
  if (!roleData?.cluster) return;

  const { clusterNaming } = await import('./execute.js');
  const { dataDir } = clusterNaming(roleData.cluster);

  // Resolve the cluster data dir once so we can bound each watch path inside it.
  // User-authored paths can contain '..' or absolute-ish segments; path.join
  // collapses '..', so without this check chokidar could watch host paths
  // outside the cluster sandbox and turn unrelated file activity into a trigger.
  const resolvedDataDir = path.resolve(dataDir);
  const paths = role.triggerConfig.file_watch.paths
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(dataDir, p))
    .filter((resolved) => {
      if (resolved === resolvedDataDir || resolved.startsWith(resolvedDataDir + path.sep)) {
        return true;
      }
      console.warn(`[cluster] Ignoring file_watch path outside cluster data dir for role ${role.id}: ${resolved}`);
      return false;
    });

  if (paths.length === 0) return;

  const debounceMs = role.triggerConfig.file_watch.debounce ?? 1000;
  let debounceTimer = null;
  const changedFiles = new Set();
  const watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
    ignored: /\/logs\//,
  });

  watcher.on('add', (filePath) => debouncedTrigger(filePath));
  watcher.on('change', (filePath) => debouncedTrigger(filePath));

  function debouncedTrigger(filePath) {
    if (filePath) {
      const relative = path.relative(dataDir, filePath);
      changedFiles.add(relative);
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const files = [...changedFiles];
      changedFiles.clear();
      try {
        const result = await acquireAndRunRole(role.id, null, { type: 'file_watch', files });
        if (!result.allowed) return;
      } catch (err) {
        console.error(`[cluster] File watch execution failed for role ${role.id}:`, err.message);
      }
    }, debounceMs);
  }

  _fileWatchers.push({ roleId: role.id, watcher });
  console.log(`[cluster] File watcher started for role ${role.id}: ${paths.join(', ')}`);
}

// ── Webhook Handler ──────────────────────────────────────────────

/**
 * Handle an incoming webhook request for a cluster role.
 * @param {string} clusterId - Cluster UUID
 * @param {string} roleId - Role UUID
 * @param {Request} request - Incoming request
 * @returns {Promise<Response>}
 */
export async function handleClusterWebhook(clusterId, roleId, request) {
  // Reject short-lived per-container agent-job keys on this route. They are
  // injected into every agent-job container, so accepting them here would let
  // any agent job (or anyone who obtains one) launch arbitrary cluster workers.
  // Mirrors the key-type guard on /api/get-agent-job-secret.
  const record = verifyApiKey(request.headers.get('x-api-key'));
  if (record && record.type === 'agent_job_api_key') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const roleData = getRoleWithCluster(roleId);
  if (!roleData || !roleData.cluster || roleData.cluster.id !== clusterId) {
    return Response.json({ error: 'Role not found or does not belong to this cluster' }, { status: 404 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    // No body is fine
  }

  const result = await acquireAndRunRole(roleData, payload, { type: 'webhook' });
  if (!result.allowed) {
    if (result.reason === 'disabled') {
      return Response.json({ error: 'Cluster is disabled' }, { status: 403 });
    }
    if (result.reason === 'concurrency') {
      return Response.json({ error: 'Max concurrency reached', max: roleData.maxConcurrency }, { status: 429 });
    }
    return Response.json({ error: result.reason }, { status: 500 });
  }

  if (result.error) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true, containerName: result.containerName });
}
