import path from 'path';
import { PROJECT_ROOT } from '../paths.js';
import { render_md } from '../utils/render-md.js';

/**
 * Build the system prompt for a coding agent.
 * @param {'agent'|'code'} mode - Chat mode
 * @param {string|null} [skillsDir] - Skills directory for {{skills}} resolution.
 *   When provided, {{skills}} resolves from this directory (e.g., workspace scope's skills/).
 *   When null, falls back to PROJECT_ROOT/skills.
 * @returns {string|null} Rendered system prompt, or null if not configured
 */
export function buildCodingAgentSystemPrompt(mode, skillsDir) {
  const file = mode === 'agent'
    ? path.join(PROJECT_ROOT, 'agent-job/SYSTEM.md')
    : path.join(PROJECT_ROOT, 'coding-workspace/SYSTEM.md');
  const rendered = render_md(file, { skillsDir });
  return rendered?.trim() || null;
}
