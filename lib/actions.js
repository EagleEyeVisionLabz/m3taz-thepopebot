import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createAgentJob } from './tools/create-agent-job.js';

const execAsync = promisify(exec);

/**
 * Prevalidate a JSON config file before tearing down and reloading from it.
 * If the file exists but is not valid JSON, the parse error is logged with the
 * caller's label and `false` is returned so the caller keeps its existing
 * (already-loaded) state. Returns `true` when the file is absent or parses
 * cleanly, meaning the caller may safely proceed with the reload.
 *
 * Shared by reloadCrons() (lib/cron.js) and reloadTriggers() (lib/triggers.js).
 *
 * @param {string} filePath - Absolute path to the JSON config file
 * @param {Object} opts
 * @param {string} opts.label - Log prefix, e.g. 'cron reload' / 'trigger reload'
 * @param {string} opts.fileName - Display name for the log, e.g. 'CRONS.json'
 * @param {string} opts.keepMsg - What is kept on failure, e.g. 'keeping existing schedule'
 * @returns {boolean} true if the reload may proceed, false to keep existing state
 */
function prevalidateJsonReload(filePath, { label, fileName, keepMsg }) {
  if (fs.existsSync(filePath)) {
    try {
      JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`[${label}] Invalid JSON in ${fileName}, ${keepMsg}: ${err.message}`);
      return false;
    }
  }
  return true;
}

/**
 * SSRF guard: reject loopback, link-local, RFC1918/unique-local, and known
 * cloud-metadata hosts. Hostnames that are not literal IPs (regular DNS names)
 * are allowed through — only obviously-internal literals and metadata names are
 * blocked here. Combined with redirect:'manual' this stops the common metadata
 * and internal-service SSRF vectors without a full DNS-resolution allowlist.
 * @param {string} hostname - URL.hostname (no brackets for IPv6)
 * @returns {boolean} true if the host must be blocked
 */
function isBlockedHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'metadata.google.internal') return true;

  // IPv6 loopback / link-local / unique-local (URL.hostname strips brackets)
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 / ::ffff:169.254.169.254)
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const ipv4 = mapped ? mapped[1] : host;

  const m = ipv4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127) return true;                 // loopback
    if (a === 10) return true;                  // RFC1918
    if (a === 192 && b === 168) return true;    // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 169 && b === 254) return true;    // link-local (incl. 169.254.169.254 metadata)
    if (a === 0) return true;                   // "this" network / 0.0.0.0
  }

  return false;
}

/**
 * Validate an action entry's type and required-by-type fields at load time.
 * Returns an error message describing the first problem, or null when the entry
 * is dispatchable. Shared by loadCrons() (lib/cron.js) and loadTriggers()
 * (lib/triggers.js) so invalid entries are skipped by name before scheduling /
 * registering, rather than failing later inside executeAction().
 *
 * @param {Object} entry - Action config (type/job/command/url, ...)
 * @returns {string|null} Error message, or null if the entry is valid
 */
function validateActionEntry(entry) {
  const type = entry.type || 'agent';
  if (!['agent', 'command', 'webhook'].includes(type)) {
    return `invalid type "${type}": must be agent, command, or webhook`;
  }
  if (type === 'command' && !entry.command) {
    return 'missing "command" field for command action';
  }
  if (type === 'webhook' && !entry.url) {
    return 'missing "url" field for webhook action';
  }
  if (type === 'agent' && !entry.job) {
    return 'missing "job" field for agent action';
  }
  return null;
}

/**
 * Execute a single action
 * @param {Object} action - { type, job, command, url, method, headers, vars, scope } (type: agent|command|webhook)
 * @param {Object} opts - { cwd, data }
 * @returns {Promise<string>} Result description for logging
 */
async function executeAction(action, opts = {}) {
  const type = action.type || 'agent';

  if (type === 'command') {
    if (typeof action.command !== 'string' || action.command.trim() === '') {
      throw new Error("command action requires a non-empty 'command' string");
    }
    const { stdout, stderr } = await execAsync(action.command, { cwd: opts.cwd });
    return (stdout || stderr || '').trim();
  }

  if (type === 'webhook') {
    if (typeof action.url !== 'string' || action.url.trim() === '') {
      throw new Error("webhook action requires a non-empty 'url' string");
    }
    // SSRF guard: only http(s), and never loopback/link-local/private/metadata targets.
    let parsedUrl;
    try { parsedUrl = new URL(action.url); } catch { throw new Error(`Invalid webhook URL: ${action.url}`); }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Webhook URL scheme not allowed: ${parsedUrl.protocol}`);
    }
    if (isBlockedHost(parsedUrl.hostname)) {
      throw new Error(`Webhook URL targets a disallowed internal/metadata host: ${parsedUrl.hostname}`);
    }
    const method = (action.method || 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...action.headers };
    // redirect:'manual' prevents a 3xx from a permitted host bypassing the
    // SSRF guard by redirecting to an internal target; timeout bounds a hung remote.
    const fetchOpts = { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) };

    if (method !== 'GET') {
      const body = { ...action.vars };
      if (opts.data) body.data = opts.data;
      fetchOpts.body = JSON.stringify(body);
    }

    const res = await fetch(action.url, fetchOpts);
    return `${method} ${action.url} → ${res.status}`;
  }

  // Default: agent
  if (typeof action.job !== 'string' || action.job.trim() === '') {
    throw new Error("agent action requires a non-empty 'job' string");
  }
  const options = {};
  if (action.llm_model) options.llmModel = action.llm_model;
  if (action.agent_backend) options.agentBackend = action.agent_backend;
  if (action.scope) options.scope = action.scope;
  if (action.user_id) options.userId = action.user_id;
  const result = await createAgentJob(action.job, options);
  return `agent-job ${result.agent_job_id} — ${result.title}`;
}

export { executeAction, prevalidateJsonReload, validateActionEntry };
