#!/usr/bin/env node
/**
 * Smoke test: spawn the bridge over stdio, complete the MCP handshake, and list
 * tools. Proves the server starts and speaks MCP. Does NOT call ThePopeBot, so
 * it needs no API key or running event handler.
 *
 * Run:  node smoke-test.mjs   (or: npm run smoke)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(__dirname, 'server.mjs')],
  stderr: 'inherit',
});
const client = new Client({ name: 'popebot-mcp-smoke', version: '1.0.0' }, { capabilities: {} });

await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
const expected = [
  'popebot_ping',
  'popebot_create_agent_job',
  'popebot_get_agent_job_status',
  'popebot_list_users',
  'popebot_send_dm',
  'popebot_trigger_cluster_role',
];
const missing = expected.filter((n) => !names.includes(n));
await client.close();

if (missing.length) {
  console.error('FAIL missing tools:', missing.join(', '));
  process.exit(1);
}
console.log(`OK ${tools.length} tools: ${names.join(', ')}`);
process.exit(0);
