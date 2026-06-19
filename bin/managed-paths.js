import fs from 'fs';
import path from 'path';

// Files tightly coupled to the package version that are auto-updated by init.
// These live in the user's project because GitHub/Docker/Next.js require them at specific paths,
// but they shouldn't drift from the package version.
// Paths ending with '/' are directories (all contents are managed).
export const MANAGED_PATHS = [
  '.github/workflows/',
  'docker-compose.yml',
  'docker-compose.custom.yml',
  '.dockerignore',
  '.gitignore',
];

export function isManaged(relPath) {
  return MANAGED_PATHS.some(p =>
    p.endsWith('/') ? (relPath === p.slice(0, -1) || relPath.startsWith(p)) : relPath === p
  );
}

// ---------------------------------------------------------------------------
// Shared scaffolding helpers
//
// These are the single source of truth for the template copy / managed-path
// delete logic used by BOTH `init` (bin/cli.js) and `sync` (bin/sync.js).
// Keeping them here prevents the two scaffolding paths from drifting and
// disagreeing about which files in a user's project get overwritten or
// deleted.
// ---------------------------------------------------------------------------

// Files that must never be scaffolded directly (use .template suffix instead).
export const EXCLUDED_FILENAMES = ['CLAUDE.md'];

// Files ending in .template are scaffolded with the suffix stripped.
// e.g. .gitignore.template → .gitignore, CLAUDE.md.template → CLAUDE.md
export function destPath(templateRelPath) {
  if (templateRelPath.endsWith('.template')) {
    return templateRelPath.slice(0, -'.template'.length);
  }
  return templateRelPath;
}

export function templatePath(userPath, templatesDir) {
  const withSuffix = userPath + '.template';
  if (fs.existsSync(path.join(templatesDir, withSuffix))) {
    return withSuffix;
  }
  return userPath;
}

/**
 * Collect all template files as relative paths (skips symlinks).
 */
export function getTemplateFiles(templatesDir) {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        // Symlinks handled separately (skill activation, .claude/skills, .pi/skills)
        continue;
      } else if (entry.isDirectory()) {
        walk(fullPath);
      } else if (!EXCLUDED_FILENAMES.includes(entry.name)) {
        files.push(path.relative(templatesDir, fullPath));
      }
    }
  }
  walk(templatesDir);
  return files;
}

/**
 * Build a filesystem-safe timestamp (YYYYMMDD-HHMMSS) for backup directories.
 */
export function backupTimestamp(now = new Date()) {
  return now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '-'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
}

/**
 * Recursively remove empty directories beneath (and including) `dir`.
 * Unconditional — callers that must protect certain paths should not use this.
 */
export function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name));
    }
  }
  // Re-read after potential child removals
  if (fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}
