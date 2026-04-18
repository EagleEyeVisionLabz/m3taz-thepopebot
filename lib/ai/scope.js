import path from 'path';
import { existsSync } from 'fs';

/**
 * Resolve working directory and skills directory for a given agent scope.
 *
 * @param {string} repoRoot - Absolute path to the git repo root
 * @param {string|null} scope - Relative subdirectory path (e.g., 'agents/gary-v') or null/empty for root
 * @returns {{ workingDir: string, skillsDir: string|null }}
 */
export function resolveAgentScope(repoRoot, scope) {
  const workingDir = scope ? path.join(repoRoot, scope) : repoRoot;

  // Skills: check scoped dir first, fall back to repo root
  const scopedSkills = path.join(workingDir, 'skills');
  const rootSkills = path.join(repoRoot, 'skills');

  let skillsDir = null;
  if (existsSync(scopedSkills)) {
    skillsDir = scopedSkills;
  } else if (existsSync(rootSkills)) {
    skillsDir = rootSkills;
  }

  return { workingDir, skillsDir };
}
