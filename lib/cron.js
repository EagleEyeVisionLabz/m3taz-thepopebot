import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './paths.js';
import { executeAction, prevalidateJsonReload, validateActionEntry } from './actions.js';
import { UPSTREAM_SLUG } from './tools/docker.js';

// Single source of truth for the crons config path (used by load + reload)
const CRON_FILE = path.join(PROJECT_ROOT, 'agent-job/CRONS.json');

// Active user cron tasks (module-scoped so reloadCrons can stop them)
let _cronTasks = [];

function getInstalledVersion() {
  const pkgPath = path.join(PROJECT_ROOT, 'node_modules', 'thepopebot', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
}

// In-memory flag for available update (read by sidebar, written by cron)
let _updateAvailable = null;

/**
 * Get the in-memory update-available version (or null).
 * @returns {string|null}
 */
function getUpdateAvailable() {
  return _updateAvailable;
}

/**
 * Set the in-memory update-available version.
 * @param {string|null} v
 */
function setUpdateAvailable(v) {
  _updateAvailable = v;
}

/**
 * Compare two semver strings numerically.
 * @param {string} candidate - e.g. "1.2.40"
 * @param {string} baseline  - e.g. "1.2.39"
 * @returns {boolean} true if candidate > baseline
 */
function isVersionNewer(candidate, baseline) {
  // Pre-release candidate is never "newer" for upgrade purposes
  if (candidate.includes('-')) return false;

  const a = candidate.split('.').map(Number);
  const b = baseline.replace(/-.*$/, '').split('.').map(Number);
  // Malformed (non-numeric) version segments are never treated as "newer"
  if (a.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/**
 * Check if a version string is a pre-release (contains '-').
 * @param {string} v
 * @returns {boolean}
 */
function isPrerelease(v) {
  return v.includes('-');
}

/**
 * Compare two semver strings (including pre-release).
 * Returns positive if a > b, negative if a < b, 0 if equal.
 * Ordering: 1.2.71-beta.0 < 1.2.71-beta.1 < 1.2.71 (stable) < 1.2.72-beta.0
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const [aCore, aPre] = a.split('-');
  const [bCore, bPre] = b.split('-');

  const aParts = aCore.split('.').map(Number);
  const bParts = bCore.split('.').map(Number);

  // Unparseable inputs compare as equal so the sort stays stable
  if (aParts.some(Number.isNaN) || bParts.some(Number.isNaN)) return 0;

  // Compare major.minor.patch
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const av = aParts[i] || 0;
    const bv = bParts[i] || 0;
    if (av !== bv) return av - bv;
  }

  // Same core version: stable beats pre-release
  if (!aPre && bPre) return 1;   // a is stable, b is pre-release
  if (aPre && !bPre) return -1;  // a is pre-release, b is stable
  if (!aPre && !bPre) return 0;  // both stable, same core

  // Both pre-release with same core: compare pre-release number
  const aNum = parseInt(aPre.split('.').pop(), 10) || 0;
  const bNum = parseInt(bPre.split('.').pop(), 10) || 0;
  return aNum - bNum;
}

/**
 * Fetch release notes from GitHub for the target version.
 * @param {string} target - Target upgrade version
 */
async function fetchAndStoreReleaseNotes(target) {
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${UPSTREAM_SLUG}/releases/tags/v${target}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!ghRes.ok) return;
    const release = await ghRes.json();
    if (release.body) {
      const { setReleaseNotes } = await import('./db/update-check.js');
      setReleaseNotes(release.body);
    }
  } catch {}
}

/**
 * Fetch a dist-tag's published version from the npm registry.
 * @param {string} distTag - e.g. "latest" or "beta"
 * @returns {Promise<Response>} the raw fetch Response (uses the standard 15s timeout)
 */
function fetchDistTag(distTag) {
  return fetch(`https://registry.npmjs.org/thepopebot/${distTag}`, { signal: AbortSignal.timeout(15000) });
}

/**
 * Fetch latest + beta dist-tags and collect every published version that is
 * strictly newer than `installed` (via compareVersions). Mirrors the original
 * inline candidate-collection loop exactly (Promise.allSettled, skip rejected,
 * skip !res.ok, require data.version).
 * @param {string} installed
 * @returns {Promise<string[]>}
 */
async function collectNewerCandidates(installed) {
  const results = await Promise.allSettled([
    fetchDistTag('latest'),
    fetchDistTag('beta'),
  ]);

  const candidates = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const res = result.value;
    if (!res.ok) continue;
    const data = await res.json();
    if (data.version && compareVersions(data.version, installed) > 0) {
      candidates.push(data.version);
    }
  }
  return candidates;
}

/**
 * Mark an update as available: in-memory flag + DB available-version + release notes.
 * @param {string} installed - the currently installed version (for logging)
 * @param {string} target - the version to upgrade to
 */
async function applyUpdateAvailable(installed, target) {
  console.log(`[version check] update available: ${installed} → ${target}`);
  setUpdateAvailable(target);
  const { setAvailableVersion } = await import('./db/update-check.js');
  setAvailableVersion(target);
  await fetchAndStoreReleaseNotes(target);
}

/**
 * Clear any previously recorded update: in-memory flag + DB available-version + release notes.
 */
async function clearUpdateAvailable() {
  setUpdateAvailable(null);
  const { clearAvailableVersion, clearReleaseNotes } = await import('./db/update-check.js');
  clearAvailableVersion();
  clearReleaseNotes();
}

/**
 * Given the candidate list, pick the highest version (via compareVersions sort)
 * and apply update-available state; otherwise clear it. Mirrors the original
 * inline "if (candidates.length > 0) { sort; best; apply } else { clear }".
 * @param {string} installed
 * @param {string[]} candidates
 */
async function applyBestCandidate(installed, candidates) {
  if (candidates.length > 0) {
    // Pick the best candidate (highest version)
    candidates.sort(compareVersions);
    const best = candidates[candidates.length - 1];
    await applyUpdateAvailable(installed, best);
  } else {
    await clearUpdateAvailable();
  }
}

/**
 * Check npm registry for a newer version of thepopebot.
 */
async function runVersionCheck() {
  try {
    const installed = getInstalledVersion();

    if (isPrerelease(installed)) {
      // Beta path: check both stable and beta dist-tags
      const candidates = await collectNewerCandidates(installed);
      await applyBestCandidate(installed, candidates);
    } else {
      // Stable path: check latest, and optionally beta if opted in
      const { getConfig } = await import('./config.js');
      const checkBeta = getConfig('UPGRADE_INCLUDE_BETA') === 'true';

      if (checkBeta) {
        // Fetch both latest and beta, pick the best candidate
        const candidates = await collectNewerCandidates(installed);
        await applyBestCandidate(installed, candidates);
      } else {
        // Default: only check stable releases
        const res = await fetchDistTag('latest');
        if (!res.ok) {
          console.warn(`[version check] npm registry returned ${res.status}`);
          return;
        }
        const data = await res.json();
        const latest = data.version;

        if (isVersionNewer(latest, installed)) {
          await applyUpdateAvailable(installed, latest);
        } else {
          await clearUpdateAvailable();
        }
      }
    }
  } catch (err) {
    console.warn(`[version check] failed: ${err.message}`);
    // Leave existing flag untouched on error
  }
}

/**
 * Start built-in crons (version check). Called from instrumentation.
 */
function startBuiltinCrons() {
  // Schedule hourly
  cron.schedule('0 * * * *', runVersionCheck);
  // Run once immediately
  runVersionCheck();
}

/**
 * Load and schedule crons from CRONS.json
 */
function loadCrons() {
  console.log('\n--- Cron Jobs ---');

  if (!fs.existsSync(CRON_FILE)) {
    console.log('No CRONS.json found');
    console.log('-----------------\n');
    _cronTasks = [];
    return;
  }

  let crons;
  try {
    crons = JSON.parse(fs.readFileSync(CRON_FILE, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse CRONS.json: ${err.message}`);
    console.log('-----------------\n');
    _cronTasks = [];
    return;
  }

  if (!Array.isArray(crons)) {
    console.error('CRONS.json must contain a JSON array');
    console.log('-----------------\n');
    _cronTasks = [];
    return;
  }

  const tasks = [];

  for (const cronEntry of crons) {
    const { name, schedule, type = 'agent', enabled } = cronEntry;
    if (enabled === false) continue;

    if (!cron.validate(schedule)) {
      console.error(`Invalid schedule for "${name}": ${schedule}`);
      continue;
    }

    // Shared type/required-field validation (same checks as webhook triggers).
    const actionError = validateActionEntry(cronEntry);
    if (actionError) {
      console.error(`Skipping cron "${name}": ${actionError}`);
      continue;
    }

    const task = cron.schedule(schedule, async () => {
      try {
        const result = await executeAction(cronEntry, { cwd: PROJECT_ROOT });
        console.log(`[CRON] ${name}: ${result || 'ran'}`);
        console.log(`[CRON] ${name}: completed!`);
      } catch (err) {
        console.error(`[CRON] ${name}: error - ${err.message}`);
      }
    });

    tasks.push({ name, schedule, type, task });
  }

  if (tasks.length === 0) {
    console.log('No active cron jobs');
  } else {
    for (const { name, schedule, type } of tasks) {
      console.log(`  ${name}: ${schedule} (${type})`);
    }
  }

  console.log('-----------------\n');

  _cronTasks = tasks;
}

/**
 * Stop existing cron tasks and re-load from CRONS.json.
 * If the new file is invalid, keeps existing tasks running.
 */
function reloadCrons() {
  // Pre-validate before stopping anything; keep existing schedule on bad JSON.
  if (!prevalidateJsonReload(CRON_FILE, {
    label: 'cron reload',
    fileName: 'CRONS.json',
    keepMsg: 'keeping existing schedule',
  })) {
    return;
  }

  for (const { task } of _cronTasks) {
    task.stop();
  }

  loadCrons();
  console.log('[cron reload] Cron schedule reloaded');
}

export { loadCrons, reloadCrons, startBuiltinCrons, getUpdateAvailable, setUpdateAvailable, getInstalledVersion, isPrerelease, runVersionCheck };
