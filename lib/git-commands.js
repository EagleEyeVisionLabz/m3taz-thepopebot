/**
 * Single source of truth for the workspace git commands.
 *
 * Used by:
 *   - Chat dropdown (lib/chat/components/code-mode-toggle.jsx)
 *   - Workspace toolbar dropup (lib/code/terminal-view.jsx)
 *   - Admin defaults select (lib/chat/components/settings-coding-agents-page.jsx)
 *   - Manual launch (lib/code/actions.js — launchWorkspaceCommand, runWorkspaceCommand)
 *   - Auto-run on chat finish (lib/ai/index.js — maybeAutoRun)
 *   - Server-side validation (lib/chat/actions.js — setModeDefault)
 *
 * Plain ESM (no 'use client'), so both server and client code can import it.
 */

export const GIT_COMMANDS = ['pull', 'commit', 'push', 'pull-push', 'create-pr'];
export const GIT_COMMAND_SET = new Set(GIT_COMMANDS);
export const FALLBACK_BY_MODE = { agent: 'pull-push', code: 'create-pr' };

export function getCommandLabel(slug) {
  return slug
    .split('-')
    .map(word => word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getCommandPrompt(command, { branch = '', featureBranch = '' } = {}) {
  switch (command) {
    case 'commit':
      return 'Stage all changes with `git add -A`. Review the staged diff with `git diff --cached`. Write a clear conventional commit message and run `git commit`. If anything fails, diagnose the issue and fix it. Do not modify any source files.';
    case 'push':
      return `Stage all changes with \`git add -A\`. Review the staged diff with \`git diff --cached\`. Write a clear conventional commit message and run \`git commit\`. Then run \`git push origin ${featureBranch || branch}\`. If anything fails, diagnose the issue and fix it. Do not modify any source files.`;
    case 'create-pr':
      return `Make sure all changes are committed — if there are uncommitted changes, stage them with \`git add -A\`, write a commit message, and commit. Push the branch with \`git push -u origin ${featureBranch}\`. Then review all commits on branch ${featureBranch} compared to ${branch} and create a pull request using \`gh pr create\` with a clear title and detailed description. If a PR already exists, update it instead. If anything fails, diagnose the issue and fix it.`;
    case 'pull':
      return `Fetch from origin with \`git fetch origin\` and rebase this branch onto \`origin/${branch}\` with \`git rebase origin/${branch}\`. If there are merge conflicts, resolve them: read each conflicting file, understand both sides, resolve correctly, \`git add\` the file, then run \`git rebase --continue\`. Repeat if new conflicts appear. If anything fails, diagnose the issue and fix it.`;
    case 'pull-push':
      return `Stage all changes with \`git add -A\`. Review the staged diff with \`git diff --cached\`. If there are staged changes, write a clear conventional commit message and run \`git commit\`. Then fetch from origin with \`git fetch origin\`. If \`origin/${featureBranch || branch}\` exists, rebase onto it with \`git rebase origin/${featureBranch || branch}\` — resolve any conflicts by reading each conflicting file, choosing the correct resolution, \`git add\` the file, then run \`git rebase --continue\`. Finally, run \`git push origin ${featureBranch || branch}\`. If anything fails, diagnose the issue and fix it.`;
    default:
      return null;
  }
}
