#!/usr/bin/env node

const [cmd, key] = process.argv.slice(2);

const apiKey = process.env.AGENT_JOB_TOKEN;
const appUrl = process.env.APP_URL;

// Default to list
if (!cmd || cmd === 'list') {
  if (!apiKey || !appUrl) {
    console.log('No agent secrets available (missing AGENT_JOB_TOKEN or APP_URL).');
    process.exit(0);
  }
  const url = `${appUrl}/api/agent-job-list-secrets`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`GET ${url} → ${res.status} ${body}`);
    process.exit(1);
  }
  const json = await res.json();
  const secrets = json.secrets;
  if (!secrets || secrets.length === 0) {
    console.log('No agent secrets configured.');
  } else {
    console.log('Available secrets:');
    secrets.forEach(s => {
      const hint = s.secretType === 'oauth2' ? '  (OAuth — use get to fetch access token)'
                 : s.secretType === 'oauth_token' ? '  (OAuth token — use get to fetch)'
                 : '';
      console.log(`  - ${s.key}${hint}`);
    });
    console.log('\nUse: agent-job-secrets get KEY_NAME');
    console.log('If a fetched value stops working, call get again for a fresh one.');
  }
  process.exit(0);
}

if (!apiKey) { console.error('AGENT_JOB_TOKEN not available'); process.exit(1); }
if (!appUrl) { console.error('APP_URL not available'); process.exit(1); }

if (cmd === 'get') {
  if (!key) { console.error('Usage: agent-job-secrets get KEY_NAME'); process.exit(1); }
  const url = `${appUrl}/api/get-agent-job-secret?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`GET ${url} → ${res.status} ${body}`);
    process.exit(1);
  }
  const json = await res.json();
  console.log(json.value);
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
console.error('Available commands: list, get');
process.exit(1);
