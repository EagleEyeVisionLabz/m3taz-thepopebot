import { exec } from 'child_process';
import { promisify } from 'util';
import { createAgentJob } from './tools/create-agent-job.js';
import { buildCodingAgentSystemPrompt } from './ai/system-prompt.js';
import { resolveAgentScope } from './ai/scope.js';
import { PROJECT_ROOT } from './paths.js';

const execAsync = promisify(exec);

/**
 * Execute a single action
 * @param {Object} action - { type, job, command, url, method, headers, vars, scope } (type: agent|command|webhook)
 * @param {Object} opts - { cwd, data }
 * @returns {Promise<string>} Result description for logging
 */
async function executeAction(action, opts = {}) {
  const type = action.type || 'agent';

  if (type === 'command') {
    const { stdout, stderr } = await execAsync(action.command, { cwd: opts.cwd });
    return (stdout || stderr || '').trim();
  }

  if (type === 'webhook') {
    const method = (action.method || 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...action.headers };
    const fetchOpts = { method, headers };

    if (method !== 'GET') {
      const body = { ...action.vars };
      if (opts.data) body.data = opts.data;
      fetchOpts.body = JSON.stringify(body);
    }

    const res = await fetch(action.url, fetchOpts);
    return `${method} ${action.url} → ${res.status}`;
  }

  // Default: agent
  const options = {};
  if (action.llm_model) options.llmModel = action.llm_model;
  if (action.agent_backend) options.agentBackend = action.agent_backend;
  if (action.scope) {
    options.scope = action.scope;
    const { skillsDir } = resolveAgentScope(PROJECT_ROOT, action.scope);
    options.systemPrompt = buildCodingAgentSystemPrompt('agent', skillsDir, action.scope);
  }
  const result = await createAgentJob(action.job, options);
  return `agent-job ${result.agent_job_id} — ${result.title}`;
}

export { executeAction };
