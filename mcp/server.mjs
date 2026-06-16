#!/usr/bin/env node
/**
 * ThePopeBot MCP bridge
 * ---------------------
 * Exposes ThePopeBot's external `/api` surface as Model Context Protocol tools
 * so the M3ta-OS wurld (Qu3bii, AionUi, Claude Code, etc.) can drive popebot as
 * a first-class tool. Speaks MCP over stdio; talks to popebot over HTTP using
 * the `x-api-key` header.
 *
 * Config resolution (first hit wins, per key):
 *   1. process.env.POPEBOT_API_URL / POPEBOT_API_KEY
 *   2. the file at POPEBOT_ENV_FILE (KEY=VALUE lines)
 *   3. a `.env` sitting next to this server
 * Secrets are never hardcoded in the MCP client config — the key lives in env or
 * a gitignored .env, so .mcp.json can be committed safely.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(p) {
  try {
    const out = {};
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = loadEnvFile(process.env.POPEBOT_ENV_FILE || join(__dirname, '.env'));
const API_URL = (process.env.POPEBOT_API_URL || fileEnv.POPEBOT_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = process.env.POPEBOT_API_KEY || fileEnv.POPEBOT_API_KEY || '';
const TIMEOUT_MS = Number(process.env.POPEBOT_TIMEOUT_MS || 30000);

async function callApi(method, apiPath, { query, body } = {}) {
  if (!API_KEY) {
    throw new Error('POPEBOT_API_KEY is not set. Add it to your env or the bridge .env (create one in ThePopeBot admin UI).');
  }
  const url = new URL(API_URL + '/api' + apiPath);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers = { 'x-api-key': API_KEY };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(`Cannot reach ThePopeBot at ${API_URL} (${err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message}). Is the event handler running and POPEBOT_API_URL correct?`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = data && typeof data === 'object' && data.error ? data.error : (typeof data === 'string' ? data : JSON.stringify(data));
    throw new Error(`popebot ${method} /api${apiPath} -> ${res.status}: ${msg}`);
  }
  return data;
}

const TOOLS = [
  {
    name: 'popebot_ping',
    description: 'Health-check the ThePopeBot event handler. Returns {message:"Pong!"} when reachable. Use to verify connectivity and configuration before issuing other calls.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'popebot_create_agent_job',
    description: 'Launch an autonomous ThePopeBot agent job. ThePopeBot creates an agent-job/* git branch, runs a coding agent (Claude Code, Pi, etc.) inside a Docker container to perform the described task, opens a PR, auto-merges, then notifies. Use for any "go do this engineering or automation task autonomously" request.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Natural-language task / prompt describing what the agent job should accomplish.' },
        llm_model: { type: 'string', description: 'Optional LLM model override for the job.' },
        agent_backend: { type: 'string', description: 'Optional agent backend (e.g. claude-code, pi).' },
        scope: { type: 'string', description: 'Optional scope hint passed to the job.' },
        user_id: { type: 'string', description: 'Optional originating user id; the PR-merge notification is DM’d to this user instead of broadcast.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'popebot_get_agent_job_status',
    description: 'Get the status of a previously created ThePopeBot agent job by its id.',
    inputSchema: {
      type: 'object',
      properties: { agent_job_id: { type: 'string', description: 'The agent job id returned by popebot_create_agent_job.' } },
      required: ['agent_job_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'popebot_list_users',
    description: 'List ThePopeBot users and their verified DM channels (e.g. telegram). Useful to discover a user_id for popebot_send_dm or to attribute an agent job.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'popebot_send_dm',
    description: "Send a direct message through ThePopeBot to a specific user's default channel, or broadcast to subscribed admins when user_id is omitted. Set system_message=true to mark it a system notification (channels with system messages disabled will skip the push).",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message text to deliver.' },
        user_id: { type: 'string', description: 'Optional target user id. Omit to broadcast to subscribed admins.' },
        system_message: { type: 'boolean', description: 'Mark as a system notification (default false).' },
        payload: { type: 'object', description: 'Optional structured payload stored with the message.', additionalProperties: true },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'popebot_trigger_cluster_role',
    description: 'Trigger execution of a ThePopeBot worker-cluster role via its webhook.',
    inputSchema: {
      type: 'object',
      properties: {
        cluster_id: { type: 'string', description: 'The cluster id.' },
        role_id: { type: 'string', description: 'The role id within the cluster.' },
        payload: { type: 'object', description: 'Optional JSON body passed to the role webhook.', additionalProperties: true },
      },
      required: ['cluster_id', 'role_id'],
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: 'popebot-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result;
    switch (name) {
      case 'popebot_ping':
        result = await callApi('GET', '/ping');
        break;
      case 'popebot_create_agent_job':
        if (!args.task) throw new Error("'task' is required");
        result = await callApi('POST', '/create-agent-job', {
          body: {
            agent_job: args.task,
            llm_model: args.llm_model,
            agent_backend: args.agent_backend,
            scope: args.scope,
            user_id: args.user_id,
          },
        });
        break;
      case 'popebot_get_agent_job_status':
        if (!args.agent_job_id) throw new Error("'agent_job_id' is required");
        result = await callApi('GET', '/agent-jobs/status', { query: { agent_job_id: args.agent_job_id } });
        break;
      case 'popebot_list_users':
        result = await callApi('GET', '/users');
        break;
      case 'popebot_send_dm':
        if (!args.message) throw new Error("'message' is required");
        result = await callApi('POST', '/send-dm', {
          body: {
            user_id: args.user_id,
            message: args.message,
            payload: args.payload,
            system_message: args.system_message === true,
          },
        });
        break;
      case 'popebot_trigger_cluster_role':
        if (!args.cluster_id || !args.role_id) throw new Error("'cluster_id' and 'role_id' are required");
        result = await callApi('POST', `/cluster/${encodeURIComponent(args.cluster_id)}/role/${encodeURIComponent(args.role_id)}/webhook`, {
          body: args.payload || {},
        });
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logs; stdout is the MCP channel.
console.error(`[popebot-mcp] ready -> ${API_URL} (api key ${API_KEY ? 'set' : 'MISSING'})`);
