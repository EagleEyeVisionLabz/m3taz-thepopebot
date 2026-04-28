#!/usr/bin/env node

const apiKey = process.env.AGENT_JOB_TOKEN;
const appUrl = process.env.APP_URL;

const args = process.argv.slice(2);
const [subcommand, ...rest] = args;

function usage() {
  console.error('Usage:');
  console.error('  agent-job-dm list');
  console.error('  agent-job-dm send <user_id> <message> [--channel telegram|default]');
  process.exit(1);
}

function requireAuth() {
  if (!apiKey) { console.error('AGENT_JOB_TOKEN not available'); process.exit(1); }
  if (!appUrl) { console.error('APP_URL not available'); process.exit(1); }
}

async function httpJson(method, path, body) {
  const url = `${appUrl}${path}`;
  const opts = { method, headers: { 'x-api-key': apiKey } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    console.error(`${method} ${url} → ${res.status} ${text}`);
    process.exit(1);
  }
  return res.json();
}

if (!subcommand) usage();
requireAuth();

if (subcommand === 'list') {
  const json = await httpJson('GET', '/api/users');
  console.log(JSON.stringify(json.users, null, 2));
  process.exit(0);
}

if (subcommand === 'send') {
  let userId = null;
  let message = null;
  let channel = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--channel') channel = rest[++i];
    else if (userId === null) userId = arg;
    else if (message === null) message = arg;
    else { console.error(`Unexpected arg: ${arg}`); usage(); }
  }
  if (!userId || !message) {
    console.error('Usage: agent-job-dm send <user_id> <message> [--channel telegram|default]');
    process.exit(1);
  }
  const body = { user_id: userId, message };
  if (channel) body.channel = channel;
  const json = await httpJson('POST', '/api/send-dm', body);
  console.log(JSON.stringify(json, null, 2));
  process.exit(0);
}

console.error(`Unknown subcommand: ${subcommand}`);
usage();
