import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from './paths.js';
import { executeAction, prevalidateJsonReload, validateActionEntry } from './actions.js';

// Single source of truth for the triggers config path (used by load + reload)
const TRIGGER_FILE = path.join(PROJECT_ROOT, 'event-handler/TRIGGERS.json');

// Cached fire function (module-scoped so reloadTriggers can reset it)
let _fireTriggers = null;

/**
 * Replace {{body.field}} templates with values from request context
 * @param {string} template - String with {{body.field}} placeholders
 * @param {Object} context - { body, query, headers }
 * @returns {string}
 */
// POSIX single-quote escaping: wrap a value so the shell treats it as one
// literal argument, neutralizing $(), backticks, ;, |, &, spaces, etc.
function shellSingleQuote(value) {
  return `'` + String(value).replace(/'/g, `'\\''`) + `'`;
}

function resolveTemplate(template, context, { shellQuote = false } = {}) {
  return template.replace(/\{\{(\w+)(?:\.(\w+))?\}\}/g, (match, source, field) => {
    const data = context[source];
    if (data === undefined) return match;
    let value;
    if (!field) value = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    else if (data[field] !== undefined) value = typeof data[field] === 'string' ? data[field] : JSON.stringify(data[field], null, 2);
    else return match;
    // For `command` actions the resolved string is executed by a shell, and
    // request data (incl. verified-but-attacker-influenced webhook payloads) is
    // untrusted — single-quote every substituted value. (audit P0: command injection)
    return shellQuote ? shellSingleQuote(value) : value;
  });
}

/**
 * Execute all actions for a trigger (fire-and-forget)
 * @param {Object} trigger - Trigger config object
 * @param {Object} context - { body, query, headers }
 */
async function executeActions(trigger, context) {
  for (const action of trigger.actions) {
    try {
      const resolved = { ...action };
      if (resolved.command) resolved.command = resolveTemplate(resolved.command, context, { shellQuote: true });
      if (resolved.job) resolved.job = resolveTemplate(resolved.job, context);
      const result = await executeAction(resolved, { cwd: PROJECT_ROOT, data: context.body });
      console.log(`[TRIGGER] ${trigger.name}: ${result || 'ran'}`);
    } catch (err) {
      console.error(`[TRIGGER] ${trigger.name}: error - ${err.message}`);
    }
  }
}

/**
 * Load triggers from TRIGGERS.json and return trigger map + fire function
 * @returns {{ triggerMap: Map, fireTriggers: Function }}
 */
function loadTriggers() {
  const triggerMap = new Map();

  console.log('\n--- Triggers ---');

  if (!fs.existsSync(TRIGGER_FILE)) {
    console.log('No TRIGGERS.json found');
    console.log('----------------\n');
    return { triggerMap, fireTriggers: () => {} };
  }

  const triggers = JSON.parse(fs.readFileSync(TRIGGER_FILE, 'utf8'));

  for (const trigger of triggers) {
    if (trigger.enabled === false) continue;

    if (!trigger.watch_path) {
      console.error(`Missing "watch_path" for trigger "${trigger.name}"`);
      continue;
    }
    if (!Array.isArray(trigger.actions) || trigger.actions.length === 0) {
      console.error(`Missing "actions" for trigger "${trigger.name}"`);
      continue;
    }

    // Validate each action up front; skip invalid ones (by trigger name), and
    // skip the whole trigger if none of its actions are dispatchable.
    const validActions = [];
    for (const action of trigger.actions) {
      const error = validateActionEntry(action);
      if (error) {
        console.error(`Skipping action in trigger "${trigger.name}": ${error}`);
        continue;
      }
      validActions.push(action);
    }
    if (validActions.length === 0) {
      console.error(`No valid actions for trigger "${trigger.name}"`);
      continue;
    }
    const validTrigger = { ...trigger, actions: validActions };

    if (!triggerMap.has(validTrigger.watch_path)) {
      triggerMap.set(validTrigger.watch_path, []);
    }
    triggerMap.get(validTrigger.watch_path).push(validTrigger);
  }

  const activeCount = [...triggerMap.values()].reduce((sum, arr) => sum + arr.length, 0);

  if (activeCount === 0) {
    console.log('No active triggers');
  } else {
    for (const [watchPath, pathTriggers] of triggerMap) {
      for (const t of pathTriggers) {
        const actionTypes = t.actions.map(a => a.type || 'agent').join(', ');
        console.log(`  ${t.name}: ${watchPath} (${actionTypes})`);
      }
    }
  }

  console.log('----------------\n');

  /**
   * Fire matching triggers for a given path (non-blocking)
   * @param {string} path - Request path (e.g., '/webhook')
   * @param {Object} body - Request body
   * @param {Object} [query={}] - Query parameters
   * @param {Object} [headers={}] - Request headers
   */
  function fireTriggers(path, body, query = {}, headers = {}) {
    const matched = triggerMap.get(path);
    if (matched) {
      const context = { body, query, headers };
      for (const trigger of matched) {
        executeActions(trigger, context).catch(err => {
          console.error(`[TRIGGER] ${trigger.name}: unhandled error - ${err.message}`);
        });
      }
    }
  }

  return { triggerMap, fireTriggers };
}

/**
 * Get the cached fire function, loading on first call.
 */
function getFireTriggers() {
  if (!_fireTriggers) {
    const result = loadTriggers();
    _fireTriggers = result.fireTriggers;
  }
  return _fireTriggers;
}

/**
 * Re-load triggers from TRIGGERS.json.
 * If the new file is invalid, keeps existing triggers.
 */
function reloadTriggers() {
  // Pre-validate before discarding anything; keep existing triggers on bad JSON.
  if (!prevalidateJsonReload(TRIGGER_FILE, {
    label: 'trigger reload',
    fileName: 'TRIGGERS.json',
    keepMsg: 'keeping existing triggers',
  })) {
    return;
  }

  _fireTriggers = null;
  // Force re-load immediately so the log output shows
  getFireTriggers();
  console.log('[trigger reload] Triggers reloaded');
}

export { loadTriggers, getFireTriggers, reloadTriggers };
