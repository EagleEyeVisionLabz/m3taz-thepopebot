import path from 'path';
import { existsSync } from 'fs';
import { PROJECT_ROOT } from '../paths.js';
import { render_md } from '../utils/render-md.js';

/**
 * Build the system prompt for a coding agent.
 * @param {'agent'|'code'} mode - Chat mode
 * @param {string|null} [skillsDir] - Skills directory for {{skills}} resolution.
 * @param {string|null} [scope] - Agent scope (e.g., 'agents/gary-vee'). When set,
 *   looks for SYSTEM.md in the scoped directory first, falls back to
 *   event-handler/agent-chat/SYSTEM.md.
 * @returns {string|null} Rendered system prompt, or null if not configured
 */
export function buildCodingAgentSystemPrompt(mode, skillsDir, scope) {
  let file;

  if (mode === 'agent') {
    // Check scoped SYSTEM.md first, fall back to event-handler/agent-chat/SYSTEM.md
    if (scope) {
      const scopedFile = path.join(PROJECT_ROOT, scope, 'SYSTEM.md');
      // `scope` is client-controlled: only honor it if it resolves to a SYSTEM.md
      // *inside* the agents/ subtree — the only legitimate scope root (per
      // getScopesHandler, scopes are `agents/<name>`). This rejects ../ traversal
      // and absolute paths that would read an arbitrary SYSTEM.md elsewhere on the host.
      const agentsRoot = path.join(PROJECT_ROOT, 'agents');
      const rel = path.relative(agentsRoot, scopedFile);
      if (!rel.startsWith('..') && !path.isAbsolute(rel) && existsSync(scopedFile)) {
        file = scopedFile;
      }
    }
    if (!file) {
      file = path.join(PROJECT_ROOT, 'event-handler/agent-chat/SYSTEM.md');
    }
  } else {
    file = path.join(PROJECT_ROOT, 'event-handler/code-chat/SYSTEM.md');
  }

  const rendered = render_md(file, { skillsDir });
  return rendered?.trim() || null;
}
