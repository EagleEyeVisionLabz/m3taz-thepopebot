#!/usr/bin/env node

/**
 * Build all Docker images locally.
 *
 * Usage:
 *   npm run docker:build            # build everything
 *   npm run docker:build -- --image event-handler   # build one (deps built first)
 *
 * Reads the version from package.json and tags each image as:
 *   stephengpope/thepopebot:{image}-{version}
 *
 * Image hierarchy:
 *
 *   thepopebot-base                           ← Ubuntu + Node + locale + Chromium + playwright + user
 *     ├── coding-agent-base                   ← + tmux, ttyd, scripts, entrypoint
 *     │     ├── coding-agent-claude-code      ← + per-agent CLI
 *     │     ├── coding-agent-pi-coding-agent
 *     │     └── ... (one per agent)
 *     └── event-handler                       ← + pm2, gosu, Next.js, server.js
 *
 * Build order:
 *   1. thepopebot-base
 *   2. coding-agent-base + event-handler in parallel
 *   3. all coding-agent variants in parallel
 *
 * Base images are tagged both versioned and unversioned (no version) so child
 * Dockerfiles can `FROM thepopebot-base` / `FROM coding-agent-base` without a
 * build-arg for local development.
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const REPO = 'stephengpope/thepopebot';

// Built first — everything depends on this.
const THEPOPEBOT_BASE = {
  name: 'thepopebot-base',
  context: 'docker/base',
  dockerfile: 'docker/base/Dockerfile',
};

// Built second — depends on thepopebot-base.
const CODING_AGENT_BASE = {
  name: 'coding-agent-base',
  context: 'docker/coding-agent',
  dockerfile: 'docker/coding-agent/Dockerfile',
};

// Built third — depend on coding-agent-base.
const CODING_AGENTS = [
  {
    name: 'coding-agent-claude-code',
    context: 'docker/coding-agent',
    dockerfile: 'docker/coding-agent/Dockerfile.claude-code',
  },
  {
    name: 'coding-agent-pi-coding-agent',
    context: 'docker/coding-agent',
    dockerfile: 'docker/coding-agent/Dockerfile.pi-coding-agent',
  },
  {
    name: 'coding-agent-gemini-cli',
    context: 'docker/coding-agent',
    dockerfile: 'docker/coding-agent/Dockerfile.gemini-cli',
  },
  {
    name: 'coding-agent-codex-cli',
    context: 'docker/coding-agent',
    dockerfile: 'docker/coding-agent/Dockerfile.codex-cli',
  },
  {
    name: 'coding-agent-opencode',
    context: 'docker/coding-agent',
    dockerfile: 'docker/coding-agent/Dockerfile.opencode',
  },
  {
    name: 'coding-agent-kimi-cli',
    context: 'docker/coding-agent',
    dockerfile: 'docker/coding-agent/Dockerfile.kimi-cli',
  },
];

// Built second — depends on thepopebot-base. Built in parallel with coding-agent-base.
const EVENT_HANDLER = {
  name: 'event-handler',
  context: '.',
  dockerfile: 'docker/event-handler/Dockerfile',
};

const ALL_IMAGES = [THEPOPEBOT_BASE, CODING_AGENT_BASE, ...CODING_AGENTS, EVENT_HANDLER];

// Parse --image flag
const filterArg = process.argv.find((_, i, a) => a[i - 1] === '--image');

if (filterArg && !ALL_IMAGES.some(img => img.name === filterArg)) {
  console.error(`Unknown image: ${filterArg}`);
  console.error(`Available: ${ALL_IMAGES.map((i) => i.name).join(', ')}`);
  process.exit(1);
}

// Pad image name for aligned output
const maxName = Math.max(...ALL_IMAGES.map((i) => i.name.length));

function buildImage(img) {
  const tag = `${REPO}:${img.name}-${VERSION}`;
  const context = path.resolve(ROOT, img.context);
  const dockerfile = path.resolve(ROOT, img.dockerfile);
  const label = img.name.padEnd(maxName);

  console.log(`  ${label}  building — ${tag}`);

  return new Promise((resolve, reject) => {
    const args = ['build', '-t', tag, '-f', dockerfile];

    // Base images get an unversioned tag too so child Dockerfiles can
    // `FROM thepopebot-base` / `FROM coding-agent-base` without a build-arg.
    if (img.name === 'thepopebot-base' || img.name === 'coding-agent-base') {
      args.push('-t', img.name);
    }

    args.push(context);

    const proc = spawn(
      'docker',
      args,
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let output = '';
    let stepInfo = '';

    function processLine(line) {
      output += line + '\n';
      // Docker build step lines (classic builder)
      const stepMatch = line.match(/^Step (\d+\/\d+)\s*:\s*(.*)/);
      if (stepMatch) {
        stepInfo = `step ${stepMatch[1]} — ${stepMatch[2]}`;
        process.stderr.write(`  ${label}  ${stepInfo}\n`);
        return;
      }
      // BuildKit step lines
      const bkMatch = line.match(/^#\d+\s+\[.*?\]\s*(.*)/);
      if (bkMatch) {
        stepInfo = bkMatch[1].trim();
        process.stderr.write(`  ${label}  ${stepInfo}\n`);
        return;
      }
      // Download / install progress
      const dlMatch = line.match(/((?:Get|Fetching|Downloading|Installing|npm|Unpacking).*)/i);
      if (dlMatch) {
        process.stderr.write(`  ${label}  ${dlMatch[1].trim().slice(0, 80)}\n`);
      }
    }

    let stdoutBuf = '';
    proc.stdout.on('data', (d) => {
      stdoutBuf += d;
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      lines.forEach(processLine);
    });

    let stderrBuf = '';
    proc.stderr.on('data', (d) => {
      stderrBuf += d;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      lines.forEach(processLine);
    });

    proc.on('close', (code) => {
      if (stdoutBuf) processLine(stdoutBuf);
      if (stderrBuf) processLine(stderrBuf);

      if (code === 0) {
        console.log(`  ${label}  done`);
        resolve(img.name);
      } else {
        console.error(`  ${label}  FAILED (exit ${code})`);
        console.error(output);
        reject(new Error(`${img.name} failed with exit code ${code}`));
      }
    });
  });
}

async function run() {
  if (filterArg) {
    // Single image build — build dependency chain too.
    if (filterArg === THEPOPEBOT_BASE.name) {
      console.log(`Building 1 image — version ${VERSION}\n`);
      await buildImage(THEPOPEBOT_BASE);
    } else if (filterArg === CODING_AGENT_BASE.name) {
      console.log(`Building 2 images — version ${VERSION}\n`);
      await buildImage(THEPOPEBOT_BASE);
      await buildImage(CODING_AGENT_BASE);
    } else if (filterArg === EVENT_HANDLER.name) {
      console.log(`Building 2 images — version ${VERSION}\n`);
      await buildImage(THEPOPEBOT_BASE);
      await buildImage(EVENT_HANDLER);
    } else if (CODING_AGENTS.some(img => img.name === filterArg)) {
      console.log(`Building 3 images — version ${VERSION}\n`);
      await buildImage(THEPOPEBOT_BASE);
      await buildImage(CODING_AGENT_BASE);
      const agent = CODING_AGENTS.find(img => img.name === filterArg);
      await buildImage(agent);
    }
    console.log('\ndone.');
    return;
  }

  // Full build: thepopebot-base → (coding-agent-base + event-handler in parallel) → variants
  const totalCount = ALL_IMAGES.length;
  console.log(`Building ${totalCount} images — version ${VERSION}\n`);

  // Step 1: thepopebot-base
  await buildImage(THEPOPEBOT_BASE);

  // Step 2: coding-agent-base and event-handler in parallel (both extend thepopebot-base)
  const tier2 = await Promise.allSettled([CODING_AGENT_BASE, EVENT_HANDLER].map(buildImage));
  const tier2Failed = tier2.filter(r => r.status === 'rejected');
  if (tier2Failed.length > 0) {
    console.error(`Tier 2 failed: ${tier2Failed.map(r => r.reason.message).join(', ')}`);
    process.exit(1);
  }

  // Step 3: all coding-agent variants in parallel
  const tier3 = await Promise.allSettled(CODING_AGENTS.map(buildImage));
  const tier3Failed = tier3.filter(r => r.status === 'rejected');
  const tier3Succeeded = tier3.filter(r => r.status === 'fulfilled');

  const succeededCount = 1 + 2 + tier3Succeeded.length;
  console.log(`\n${succeededCount}/${totalCount} images built successfully.`);

  if (tier3Failed.length > 0) {
    console.error(`${tier3Failed.length} failed: ${tier3Failed.map(r => r.reason.message).join(', ')}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
