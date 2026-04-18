import fs from 'fs';
import path from 'path';
import { PROJECT_ROOT } from '../paths.js';

const INCLUDE_PATTERN = /\{\{([^}]+\.md)\}\}/g;
const VARIABLE_PATTERN = /\{\{(datetime|skills)\}\}/gi;

// Default skills directory (used when no explicit skillsDir is provided)
const defaultSkillsDir = path.join(PROJECT_ROOT, 'skills');

/**
 * Scan a skills directory for SKILL.md files and extract descriptions
 * from YAML frontmatter. Returns a bullet list of descriptions.
 *
 * @param {string|null} [skillsDir] - Absolute path to skills directory.
 *   Falls back to PROJECT_ROOT/skills if not provided.
 * @returns {string}
 */
function loadSkillDescriptions(skillsDir) {
  const dir = skillsDir || defaultSkillsDir;
  try {
    if (!fs.existsSync(dir)) {
      return 'No additional abilities configured.';
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const descriptions = [];

    for (const entry of entries) {
      // Follow symlinks — resolve to check if target is a directory
      const entryPath = path.join(dir, entry.name);
      let isDir = entry.isDirectory() || entry.isSymbolicLink();
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(entryPath);
          isDir = stat.isDirectory();
        } catch { continue; } // broken symlink
      }
      if (!isDir) continue;

      const skillMdPath = path.join(entryPath, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, 'utf8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const frontmatter = frontmatterMatch[1];
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        descriptions.push(`- **${entry.name}**: ${descMatch[1].trim()}`);
      }
    }

    if (descriptions.length === 0) {
      return 'No additional abilities configured.';
    }

    return descriptions.join('\n');
  } catch {
    return 'No additional abilities configured.';
  }
}

/**
 * Resolve built-in variables like {{datetime}} and {{skills}}.
 * @param {string} content - Content with possible variable placeholders
 * @param {object} [vars] - Variable overrides
 * @param {string|null} [vars.skillsDir] - Skills directory for {{skills}} resolution
 * @returns {string} Content with variables resolved
 */
function resolveVariables(content, vars = {}) {
  return content.replace(VARIABLE_PATTERN, (match, variable) => {
    switch (variable.toLowerCase()) {
      case 'datetime':
        return new Date().toISOString();
      case 'skills':
        return loadSkillDescriptions(vars.skillsDir || null);
      default:
        return match;
    }
  });
}

/**
 * Render a markdown file, resolving {{filepath}} includes recursively
 * and {{datetime}}, {{skills}} built-in variables.
 * Referenced file paths resolve relative to the project root.
 * @param {string} filePath - Absolute path to the markdown file
 * @param {object} [options] - Render options
 * @param {string|null} [options.skillsDir] - Skills directory for {{skills}} resolution
 * @param {string[]} [options._chain] - Internal: already-resolved file paths (circular detection)
 * @returns {string} Rendered markdown content
 */
function render_md(filePath, options = {}) {
  // Support legacy positional arg: render_md(path, chain)
  if (Array.isArray(options)) {
    options = { _chain: options };
  }

  const chain = options._chain || [];
  const resolved = path.resolve(filePath);

  if (chain.includes(resolved)) {
    const cycle = [...chain, resolved].map((p) => path.relative(PROJECT_ROOT, p)).join(' -> ');
    console.log(`[render_md] Circular include detected: ${cycle}`);
    return '';
  }

  if (!fs.existsSync(resolved)) {
    return '';
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const currentChain = [...chain, resolved];

  const withIncludes = content.replace(INCLUDE_PATTERN, (match, includePath) => {
    const includeResolved = path.resolve(PROJECT_ROOT, includePath.trim());
    if (!fs.existsSync(includeResolved)) {
      return match;
    }
    return render_md(includeResolved, { ...options, _chain: currentChain });
  });

  return resolveVariables(withIncludes, { skillsDir: options.skillsDir || null });
}

export { render_md, loadSkillDescriptions };
