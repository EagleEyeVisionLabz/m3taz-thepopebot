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
  // `scope` is client-controlled (cron/trigger config, agent-job params). It must
  // resolve to a directory *inside* repoRoot — reject `../` traversal and absolute
  // paths so the agent's working dir can't escape onto the host filesystem.
  // (audit P0: ai-llm path-traversal host escape)
  let workingDir = repoRoot;
  if (scope) {
    const candidate = path.resolve(repoRoot, scope);
    const rel = path.relative(repoRoot, candidate);
    if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
      throw new Error(`Invalid scope (escapes project root): ${scope}`);
    }
    workingDir = candidate;
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
