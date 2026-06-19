#!/usr/bin/env node

/**
 * Interactive SSL setup — configures Let's Encrypt wildcard cert via Traefik DNS challenge.
 *
 * Prompts for domain, DNS provider, API credentials, and server address.
 * Creates the wildcard DNS record via the provider's API.
 * Writes SSL config to .env, DNS provider credentials to .env.traefik,
 * and switches COMPOSE_FILE to docker-compose.custom.yml.
 */

import fs from 'fs';
import path from 'path';
import * as clack from '@clack/prompts';
import { updateEnvVariable } from './lib/auth.mjs';
import { loadEnvFile } from './lib/env.mjs';

function handleCancel(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  return value;
}

// DNS providers supported by Traefik's ACME DNS challenge (via lego).
// Each entry maps to the Traefik provider name and the env vars it expects.
const DNS_PROVIDERS = {
  cloudflare: {
    label: 'Cloudflare',
    traefikName: 'cloudflare',
    envVars: [
      { key: 'CF_DNS_API_TOKEN', label: 'Cloudflare API Token', secret: true },
    ],
    apiCreate: createCloudflareRecord,
    helpUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    helpSteps: [
      'Go to your Cloudflare dashboard → Profile → API Tokens',
      'Click "Create Token"',
      'Use the "Edit zone DNS" template',
      'Select the zone (domain) you want to use',
      'Copy the token',
    ],
  },
  route53: {
    label: 'AWS Route 53',
    traefikName: 'route53',
    envVars: [
      { key: 'AWS_ACCESS_KEY_ID', label: 'AWS Access Key ID', secret: false },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key', secret: true },
      { key: 'AWS_REGION', label: 'AWS Region', secret: false, default: 'us-east-1' },
    ],
    apiCreate: null, // TODO: implement
    helpUrl: 'https://console.aws.amazon.com/iam/',
    helpSteps: [
      'Create an IAM user with Route53 permissions',
      'Generate access keys for the user',
    ],
  },
  digitalocean: {
    label: 'DigitalOcean',
    traefikName: 'digitalocean',
    envVars: [
      { key: 'DO_AUTH_TOKEN', label: 'DigitalOcean API Token', secret: true },
    ],
    apiCreate: null, // TODO: implement
    helpUrl: 'https://cloud.digitalocean.com/account/api/tokens',
    helpSteps: [
      'Go to DigitalOcean → API → Tokens',
      'Generate a new personal access token with read/write scope',
    ],
  },
  namecheap: {
    label: 'Namecheap',
    traefikName: 'namecheap',
    envVars: [
      { key: 'NAMECHEAP_API_USER', label: 'Namecheap API User', secret: false },
      { key: 'NAMECHEAP_API_KEY', label: 'Namecheap API Key', secret: true },
    ],
    apiCreate: null, // TODO: implement
    helpUrl: 'https://www.namecheap.com/support/api/intro/',
    helpSteps: [
      'Enable API access in your Namecheap account',
      'Whitelist your server IP',
      'Copy your API key',
    ],
  },
  godaddy: {
    label: 'GoDaddy',
    traefikName: 'godaddy',
    envVars: [
      { key: 'GODADDY_API_KEY', label: 'GoDaddy API Key', secret: true },
      { key: 'GODADDY_API_SECRET', label: 'GoDaddy API Secret', secret: true },
    ],
    apiCreate: null, // TODO: implement
    helpUrl: 'https://developer.godaddy.com/keys',
    helpSteps: [
      'Go to GoDaddy Developer Portal → API Keys',
      'Create a Production key',
    ],
  },
  porkbun: {
    label: 'Porkbun',
    traefikName: 'porkbun',
    envVars: [
      { key: 'PORKBUN_API_KEY', label: 'Porkbun API Key', secret: true },
      { key: 'PORKBUN_SECRET_API_KEY', label: 'Porkbun Secret Key', secret: true },
    ],
    apiCreate: null, // TODO: implement
    helpUrl: 'https://porkbun.com/account/api',
    helpSteps: [
      'Go to Porkbun → Account → API Access',
      'Create an API key pair',
    ],
  },
};

async function main() {
  clack.intro('SSL Setup — Let\'s Encrypt wildcard cert');

  const env = loadEnvFile() || {};

  // ── Domain ──────────────────────────────────────────────────────────
  const existingDomain = env.SSL_DOMAIN;
  let domain;

  if (existingDomain) {
    clack.log.info(`Current domain: ${existingDomain}`);
    const reconfig = handleCancel(await clack.confirm({
      message: 'Change domain?',
      initialValue: false,
    }));
    domain = reconfig ? null : existingDomain;
  }

  if (!domain) {
    domain = handleCancel(await clack.text({
      message: 'Enter your domain (e.g., bot.example.com):',
      placeholder: 'bot.example.com',
      validate: (input) => {
        if (!input) return 'Domain is required';
        if (!input.includes('.')) return 'Enter a valid domain';
        if (input.startsWith('*.')) return 'Enter the base domain without the wildcard (e.g., bot.example.com)';
      },
    }));
  }

  // ── Email ───────────────────────────────────────────────────────────
  const existingEmail = env.SSL_EMAIL;
  let email;

  if (existingEmail) {
    clack.log.info(`Current email: ${existingEmail}`);
    const reconfig = handleCancel(await clack.confirm({
      message: 'Change email?',
      initialValue: false,
    }));
    email = reconfig ? null : existingEmail;
  }

  if (!email) {
    email = handleCancel(await clack.text({
      message: 'Email for Let\'s Encrypt notifications:',
      validate: (input) => {
        if (!input) return 'Email is required';
        if (!input.includes('@')) return 'Enter a valid email';
      },
    }));
  }

  // ── DNS Provider ────────────────────────────────────────────────────
  const providerKey = handleCancel(await clack.select({
    message: 'Who manages your DNS?',
    options: Object.entries(DNS_PROVIDERS).map(([key, p]) => ({
      label: p.label,
      value: key,
    })),
  }));

  const provider = DNS_PROVIDERS[providerKey];

  // Show help steps for getting the API credentials
  clack.log.info(
    `To get your ${provider.label} API credentials:\n` +
    provider.helpSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
    `\n\n  ${provider.helpUrl}`
  );

  // ── API Credentials ─────────────────────────────────────────────────
  const credentials = {};
  for (const envVar of provider.envVars) {
    const existing = env[envVar.key];
    if (existing) {
      const masked = '****' + existing.slice(-4);
      clack.log.info(`${envVar.label}: ${masked}`);
      const reconfig = handleCancel(await clack.confirm({
        message: `Change ${envVar.label}?`,
        initialValue: false,
      }));
      if (!reconfig) {
        credentials[envVar.key] = existing;
        continue;
      }
    }

    if (envVar.secret) {
      credentials[envVar.key] = handleCancel(await clack.password({
        message: `${envVar.label}:`,
        validate: (input) => {
          if (!input && !envVar.default) return `${envVar.label} is required`;
        },
      }));
    } else {
      credentials[envVar.key] = handleCancel(await clack.text({
        message: `${envVar.label}:`,
        defaultValue: envVar.default || '',
        placeholder: envVar.default || '',
        validate: (input) => {
          if (!input && !envVar.default) return `${envVar.label} is required`;
        },
      }));
    }
    credentials[envVar.key] = credentials[envVar.key] || envVar.default;
  }

  // ── DNS Record Target ──────────────────────────────────────────────
  const targetType = handleCancel(await clack.select({
    message: `How should *.${domain} resolve?`,
    options: [
      { label: 'IP address (VPS, bare metal, cloud VM)', value: 'A' },
      { label: 'CNAME (Tailscale hostname, another domain)', value: 'CNAME' },
    ],
  }));

  let recordValue;
  if (targetType === 'A') {
    // Try to detect public IP
    let detectedIp;
    try {
      const resp = await fetch('https://api.ipify.org');
      if (resp.ok) detectedIp = (await resp.text()).trim();
    } catch {}

    recordValue = handleCancel(await clack.text({
      message: 'Server IP address:',
      defaultValue: detectedIp || '',
      placeholder: detectedIp || '203.0.113.10',
      validate: (input) => {
        if (!input) return 'IP address is required';
        if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input)) return 'Enter a valid IPv4 address';
      },
    }));
  } else {
    recordValue = handleCancel(await clack.text({
      message: 'CNAME target (e.g., mybox.tailnet.ts.net):',
      validate: (input) => {
        if (!input) return 'CNAME target is required';
        if (!input.includes('.')) return 'Enter a valid hostname';
      },
    }));
  }

  // ── Create DNS Record ──────────────────────────────────────────────
  const s = clack.spinner();

  if (provider.apiCreate) {
    s.start(`Creating *.${domain} ${targetType} record → ${recordValue}`);
    try {
      await provider.apiCreate(domain, targetType, recordValue, credentials);
      s.stop(`Created *.${domain} → ${recordValue}`);
    } catch (err) {
      s.stop(`Failed to create DNS record: ${err.message}`);
      clack.log.warn(
        `Create this record manually in your ${provider.label} dashboard:\n` +
        `  Type: ${targetType}\n` +
        `  Name: *.${domain}\n` +
        `  Value: ${recordValue}`
      );
      const proceed = handleCancel(await clack.confirm({
        message: 'Continue anyway? (you can create the record manually)',
        initialValue: true,
      }));
      if (!proceed) process.exit(0);
    }
  } else {
    clack.log.warn(
      `Automatic DNS record creation is not yet supported for ${provider.label}.\n` +
      `  Create this record in your ${provider.label} dashboard:\n\n` +
      `  Type: ${targetType}\n` +
      `  Name: *.${domain}\n` +
      `  Value: ${recordValue}\n`
    );
    handleCancel(await clack.text({
      message: 'Press enter once you\'ve created the record',
      defaultValue: '',
    }));
  }

  // ── Write .env ─────────────────────────────────────────────────────
  s.start('Writing configuration to .env');

  updateEnvVariable('SSL_DOMAIN', domain);
  updateEnvVariable('SSL_EMAIL', email);
  updateEnvVariable('SSL_DNS_PROVIDER', provider.traefikName);

  // Set APP_HOSTNAME only if not already set (don't overwrite existing webhook hostname)
  if (!env.APP_HOSTNAME) {
    updateEnvVariable('APP_HOSTNAME', domain);
  }

  // Write DNS provider credentials to .env.traefik (Traefik-only, not leaked to other services)
  const traefikEnvPath = path.join(process.cwd(), '.env.traefik');
  const traefikLines = provider.envVars.map((v) => `${v.key}=${credentials[v.key]}`);
  fs.writeFileSync(traefikEnvPath, traefikLines.join('\n') + '\n');

  // Switch to custom compose file
  updateEnvVariable('COMPOSE_FILE', 'docker-compose.custom.yml');

  s.stop('Configuration saved to .env and .env.traefik');

  // ── Summary ────────────────────────────────────────────────────────
  clack.log.success(
    `SSL configured!\n\n` +
    `  Domain:    ${domain}\n` +
    `  Wildcard:  *.${domain}\n` +
    `  Provider:  ${provider.label}\n` +
    `  Compose:   docker-compose.custom.yml\n\n` +
    `  Traefik will automatically obtain and renew your wildcard cert.\n\n` +
    `  Next: restart your containers with \`docker compose up -d\``
  );

  clack.outro('Done!');
}

// ── Cloudflare API ─────────────────────────────────────────────────────

async function createCloudflareRecord(domain, type, value, credentials) {
  const token = credentials.CF_DNS_API_TOKEN;

  // Find the zone — walk up the domain to find the registered zone.
  // e.g., for "bot.example.com", the zone is "example.com"
  const parts = domain.split('.');
  let zoneId;
  let zoneName;

  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(candidate)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (data.result?.length > 0) {
      zoneId = data.result[0].id;
      zoneName = data.result[0].name;
      break;
    }
  }

  if (!zoneId) {
    throw new Error(`Could not find a Cloudflare zone for ${domain}. Make sure your domain is added to Cloudflare.`);
  }

  // Create the wildcard record: *.domain → value
  const recordName = `*.${domain}`;

  // Check if record already exists
  const existingResp = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(recordName)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const existing = await existingResp.json();

  if (existing.result?.length > 0) {
    // Update existing record
    const recordId = existing.result[0].id;
    const updateResp = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, name: recordName, content: value, proxied: false }),
      }
    );
    const updateData = await updateResp.json();
    if (!updateData.success) {
      throw new Error(updateData.errors?.[0]?.message || 'Failed to update DNS record');
    }
  } else {
    // Create new record
    const createResp = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, name: recordName, content: value, proxied: false }),
      }
    );
    const createData = await createResp.json();
    if (!createData.success) {
      throw new Error(createData.errors?.[0]?.message || 'Failed to create DNS record');
    }
  }
}

main().catch((err) => {
  clack.log.error(err.message);
  process.exit(1);
});
