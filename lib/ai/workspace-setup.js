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
 * Set up the workspace once. If `.git` already exists, returns immediately
 * and never touches git — git is the source of truth from then on.
 *
 * First-setup steps: gh auth setup-git, shallow clone the base branch,
 * set git identity, checkout the feature branch (or stay on base).
 *
 * @param {object} opts
 * @param {string} opts.workspaceDir - Absolute path to workspace directory (the git repo root)
 * @param {string} opts.repo - GitHub owner/repo (e.g. "owner/repo")
 * @param {string} opts.branch - Base branch (e.g. "main")
 * @param {string} [opts.featureBranch] - Feature branch to create on first setup
 */
export async function ensureWorkspaceRepo({ workspaceDir, repo, branch, featureBranch }) {
  // Already set up — never touch git again.
  if (existsSync(path.join(workspaceDir, '.git'))) return '';

  if (!repo) throw new Error('ensureWorkspaceRepo: repo is required for initial clone');
  if (!branch) throw new Error(`ensureWorkspaceRepo: branch is required (could not resolve default branch for ${repo})`);

  const ghToken = getConfig('GH_TOKEN');
  const env = { ...process.env };
  if (ghToken) env.GH_TOKEN = ghToken;

  mkdirSync(workspaceDir, { recursive: true });
  const execOpts = { cwd: workspaceDir, env };
  const log = [];

  if (ghToken) {
    const out = await run('gh', ['auth', 'setup-git'], execOpts);
    if (out) log.push(out);
  }

  await run('git', ['clone', '--depth', '1', '--branch', branch, `https://github.com/${repo}`, '.'], execOpts);
  log.push(`Cloned ${repo} (branch: ${branch}, depth 1)`);

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

  if (featureBranch && featureBranch !== branch) {
    await run('git', ['checkout', '-b', featureBranch], execOpts);
    log.push(`Created and checked out ${featureBranch}`);
  } else {
    await run('git', ['checkout', branch], execOpts);
    log.push(`On ${branch}`);
  }

  return log.join('\n');
}
