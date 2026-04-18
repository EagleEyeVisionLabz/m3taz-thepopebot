import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getConfig } from '../config.js';

const execFile = promisify(execFileCb);

/**
 * Run a command and return stdout. Rejects on non-zero exit.
 */
async function run(cmd, args, opts) {
  const { stdout } = await execFile(cmd, args, opts);
  return stdout.trim();
}

/**
 * Ensure workspace directory exists and contains the git repo
 * on the correct branch. Idempotent — safe to call on every message.
 *
 * Replaces Docker entrypoint scripts: setup-git.sh, clone.sh, feature-branch.sh.
 *
 * @param {object} opts
 * @param {string} opts.workspaceDir - Absolute path to workspace directory (the git repo root)
 * @param {string} opts.repo - GitHub owner/repo (e.g. "owner/repo")
 * @param {string} opts.branch - Base branch (e.g. "main")
 * @param {string} [opts.featureBranch] - Feature branch to create/checkout
 */
export async function ensureWorkspaceRepo({ workspaceDir, repo, branch, featureBranch }) {
  const ghToken = getConfig('GH_TOKEN');
  const env = { ...process.env };
  if (ghToken) env.GH_TOKEN = ghToken;

  const execOpts = { cwd: workspaceDir, env };
  const log = [];

  // 1. Create workspace directory
  mkdirSync(workspaceDir, { recursive: true });

  // 2. Configure git to use GH_TOKEN for GitHub HTTPS URLs (mirrors setup-git.sh)
  if (ghToken) {
    const out = await run('gh', ['auth', 'setup-git'], execOpts);
    if (out) log.push(out);
  }

  // 3. Clone if not already a git repo
  const hasGit = existsSync(path.join(workspaceDir, '.git'));
  if (!hasGit) {
    if (!repo) throw new Error('ensureWorkspaceRepo: repo is required for initial clone');
    const out = await run('git', ['clone', '--branch', branch || 'main', `https://github.com/${repo}`, '.'], execOpts);
    log.push(`Cloned ${repo} (branch: ${branch || 'main'})`);
    if (out) log.push(out);
  }

  // 3. Git identity (only if not already configured)
  try {
    await run('git', ['config', 'user.name'], execOpts);
  } catch {
    // Not configured — derive from GitHub token
    if (ghToken) {
      try {
        const userJson = await run('gh', ['api', 'user', '-q', '{name: .name, login: .login, email: .email, id: .id}'], execOpts);
        const user = JSON.parse(userJson);
        const name = user.name || user.login;
        const email = user.email || `${user.id}+${user.login}@users.noreply.github.com`;
        await run('git', ['config', 'user.name', name], execOpts);
        await run('git', ['config', 'user.email', email], execOpts);
        log.push(`Git identity: ${name} <${email}>`);
      } catch (err) {
        console.error('[workspace-setup] Failed to set git identity:', err.message);
      }
    }
  }

  // 4. Feature branch checkout
  if (!featureBranch) return log.join('\n');

  // Already on the right branch locally?
  try {
    await run('git', ['rev-parse', '--verify', featureBranch], execOpts);
    // Branch exists locally — make sure we're on it
    const current = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], execOpts);
    if (current !== featureBranch) {
      await run('git', ['checkout', featureBranch], execOpts);
      log.push(`Checked out ${featureBranch}`);
    } else {
      log.push(`Already on ${featureBranch}`);
    }
    return log.join('\n');
  } catch {
    // Branch doesn't exist locally — check remote
  }

  try {
    const remoteCheck = await run('git', ['ls-remote', '--heads', 'origin', featureBranch], execOpts);
    if (remoteCheck) {
      // Remote branch exists — checkout tracking it
      await run('git', ['checkout', '-B', featureBranch, `origin/${featureBranch}`], execOpts);
      log.push(`Checked out ${featureBranch} (tracking origin)`);
    } else {
      // Create new branch and push
      await run('git', ['checkout', '-b', featureBranch], execOpts);
      const pushOut = await run('git', ['push', '-u', 'origin', featureBranch], execOpts);
      log.push(`Created and pushed ${featureBranch}`);
      if (pushOut) log.push(pushOut);
    }
  } catch (err) {
    console.error('[workspace-setup] Feature branch error:', err.message);
    throw err;
  }

  return log.join('\n');
}
