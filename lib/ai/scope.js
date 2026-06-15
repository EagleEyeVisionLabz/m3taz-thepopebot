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
  // `scope` is client-controlled. Resolve it but clamp inside repoRoot so a
  // value like '../../..' or an absolute path cannot move the agent's working
  // directory onto the host filesystem.
  let workingDir = repoRoot;
  if (scope) {
    const candidate = path.resolve(repoRoot, scope);
    const rel = path.relative(repoRoot, candidate);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      workingDir = candidate;
    } else {
      console.warn(`[scope] ignoring out-of-root scope "${scope}" — using repo root`);
    }
  }

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
