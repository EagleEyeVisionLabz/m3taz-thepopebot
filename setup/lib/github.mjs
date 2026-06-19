import { execSync, execFileSync, exec } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { ghEnv, getGitRemoteInfo } from './prerequisites.mjs';

const execAsync = promisify(exec);

/**
 * Validate GitHub PAT by making a test API call
 */
export async function validatePAT(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) return { valid: false, error: 'Invalid token' };
    const user = await response.json();
    return { valid: true, user: user.login };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Check PAT scopes/permissions
 * Works with both classic tokens (x-oauth-scopes header) and fine-grained tokens
 */
export async function checkPATScopes(token) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    const scopes = response.headers.get('x-oauth-scopes') || '';
    const scopeList = scopes.split(',').map((s) => s.trim()).filter(Boolean);

    // Classic tokens have x-oauth-scopes header
    if (scopeList.length > 0) {
      return {
        hasRepo: scopeList.includes('repo'),
        hasWorkflow: scopeList.includes('workflow'),
        scopes: scopeList,
        isFineGrained: false,
        verified: true,
      };
    }

    // Fine-grained tokens don't emit x-oauth-scopes. Instead of assuming the
    // token is fully scoped, probe the target repo and inspect the coarse
    // `permissions` object GitHub returns. `push: true` means the token has
    // write access (the prerequisite for creating branches/PRs and writing
    // Contents/Actions), so we treat that as the pass signal for the setup
    // scope gate. If the repo can't be resolved or the probe can't run, we
    // fall back to the previous assume-valid behavior so a working token is
    // never blocked merely because verification was impossible.
    const remote = await getRepoPermissions(token);
    if (remote && remote.permissions) {
      const canWrite = remote.permissions.push === true || remote.permissions.admin === true;
      return {
        hasRepo: canWrite,
        hasWorkflow: canWrite,
        scopes: [],
        isFineGrained: true,
        verified: true,
        permissions: remote.permissions,
      };
    }

    // Could not verify (no resolvable owner/repo, or repo probe failed):
    // assume valid so the recommended fine-grained token flow is not blocked,
    // but flag that scopes were not actually verified.
    return {
      hasRepo: true,
      hasWorkflow: true,
      scopes: [],
      isFineGrained: true,
      verified: false,
    };
  } catch {
    return { hasRepo: false, hasWorkflow: false, scopes: [], isFineGrained: false, verified: false };
  }
}

/**
 * Probe the target repository's coarse permissions for a (fine-grained) token.
 * Resolves owner/repo from the git remote so the public checkPATScopes(token)
 * signature stays unchanged. Returns the parsed repo object (with its
 * `permissions` field) on success, or null when the repo can't be resolved or
 * the request fails — callers treat null as "unable to verify".
 */
async function getRepoPermissions(token) {
  try {
    const info = getGitRemoteInfo();
    if (!info || !info.owner || !info.repo) return null;
    const response = await fetch(
      `https://api.github.com/repos/${info.owner}/${info.repo}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Set a GitHub repository secret using gh CLI
 */
export async function setSecret(owner, repo, name, value) {
  try {
    execFileSync(
      'gh',
      ['secret', 'set', name, '--repo', `${owner}/${repo}`],
      { input: value, encoding: 'utf-8', env: ghEnv(), stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Set a GitHub repository variable using gh CLI
 */
export async function setVariable(owner, repo, name, value) {
  // name/owner/repo are interpolated into a shell command; validate them to block
  // command injection. `value` is passed via stdin, so it is already safe.
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    return { success: false, error: `Invalid variable name: ${name}` };
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return { success: false, error: 'Invalid owner/repo' };
  }
  try {
    execFileSync(
      'gh',
      ['variable', 'set', name, '--repo', `${owner}/${repo}`],
      { input: value, encoding: 'utf-8', env: ghEnv(), stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Generate a random webhook secret
 */
export function generateWebhookSecret() {
  return randomBytes(32).toString('hex');
}

/**
 * Get the GitHub PAT creation URL with pre-selected scopes
 */
export function getPATCreationURL() {
  return 'https://github.com/settings/personal-access-tokens/new';
}
