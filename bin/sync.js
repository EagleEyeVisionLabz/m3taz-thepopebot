/**
 * sync.js — Mirrors package templates into a user project and rebuilds.
 *
 * mirrorTemplates() uses the same scaffolding logic as `init` (cli.js):
 *
 *   1. COPY: Walk templates/ recursively:
 *      - New files → created
 *      - Identical files → skipped
 *      - Managed files that differ → backed up + overwritten
 *      - Non-managed files that differ → skipped (reported as available)
 *      - .template suffix is stripped from destination filenames
 *      - Files named CLAUDE.md are excluded (EXCLUDED_FILENAMES)
 *
 *   2. DELETE STALE: Only walks managed DIRECTORIES (from managed-paths.js).
 *      Files in managed dirs with no corresponding template are backed up
 *      and deleted.
 *
 *   3. REMOVE EMPTY DIRS: Only within managed directories.
 *
 *   All deleted/overwritten files are backed up to .backups/{timestamp}/.
 *
 * sync() orchestrates the full pipeline:
 *   1. Build package JSX (npm run build)
 *   2. npm pack → copy tarball to project
 *   3. mirrorTemplates() — scaffold using init's managed-path logic
 *   4. npm install tarball on host (--no-save)
 *   5. Docker image build (patches Dockerfile for local tarball, includes Next.js build)
 *   6. docker compose up -d -V event-handler
 *   7. Cleanup tarball
 */
import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MANAGED_PATHS,
  isManaged,
  destPath,
  templatePath,
  getTemplateFiles,
  backupTimestamp,
  removeEmptyDirs,
} from './managed-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_DIR = path.join(__dirname, '..');

/**
 * Mirror templates into a project using the same scaffolding logic as `init`.
 *
 * Copy phase:
 *   - New files → created
 *   - Identical files → skipped
 *   - Managed files that differ → backed up + overwritten
 *   - Non-managed files that differ → skipped
 *
 * Delete phase (managed directories only):
 *   - Stale files in managed dirs with no corresponding template → backed up + deleted
 *   - Empty directories within managed dirs → removed
 */
function mirrorTemplates(projectPath) {
  const templatesDir = path.join(PACKAGE_DIR, 'templates');
  const templateFiles = getTemplateFiles(templatesDir);

  const created = [];
  const skipped = [];
  const changed = [];
  const updated = [];
  const backedUp = [];

  let backupDir = null;
  function getBackupDir() {
    if (!backupDir) {
      backupDir = path.join(projectPath, '.backups', backupTimestamp());
    }
    return backupDir;
  }

  function backupFile(filePath, relPath) {
    const bd = getBackupDir();
    const dest = path.join(bd, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(filePath, dest);
    backedUp.push(relPath);
  }

  // 1a. Recreate symlinks from templates
  function walkSymlinks(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(templatesDir, fullPath);
      if (entry.isSymbolicLink()) {
        const outPath = destPath(relPath);
        const dest = path.join(projectPath, outPath);
        const target = fs.readlinkSync(fullPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        try { fs.unlinkSync(dest); } catch {}
        fs.symlinkSync(target, dest);
        console.log(`    ${outPath} -> ${target}`);
      } else if (entry.isDirectory()) {
        walkSymlinks(fullPath);
      }
    }
  }
  walkSymlinks(templatesDir);

  // 1b. Copy template files using init's managed/non-managed logic
  for (const relPath of templateFiles) {
    const src = path.join(templatesDir, relPath);
    const outPath = destPath(relPath);
    const dest = path.join(projectPath, outPath);

    if (!fs.existsSync(dest)) {
      // File doesn't exist — create it
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      created.push(outPath);
      console.log(`    Created ${outPath}`);
    } else {
      // File exists — check if template has changed
      const srcContent = fs.readFileSync(src);
      const destContent = fs.readFileSync(dest);
      if (srcContent.equals(destContent)) {
        skipped.push(outPath);
      } else if (isManaged(outPath)) {
        // Managed file differs — back up before overwriting
        backupFile(dest, outPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        updated.push(outPath);
        console.log(`    Updated ${outPath}`);
      } else {
        changed.push(outPath);
        console.log(`    Skipped ${outPath} (already exists)`);
      }
    }
  }

  // 2. Delete stale files in managed directories that no longer exist in templates
  const deleted = [];
  const managedDirs = MANAGED_PATHS.filter(p => p.endsWith('/'));
  for (const managedDir of managedDirs) {
    const userDir = path.join(projectPath, managedDir);
    if (!fs.existsSync(userDir)) continue;

    // Walk the user's managed directory
    function walkUser(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkUser(fullPath);
        } else {
          const relPath = path.relative(projectPath, fullPath);
          // Check if a corresponding template exists
          const tmplPath = templatePath(relPath, templatesDir);
          const templateExists = fs.existsSync(path.join(templatesDir, tmplPath));
          if (!templateExists) {
            backupFile(fullPath, relPath);
            fs.unlinkSync(fullPath);
            deleted.push(relPath);
            console.log(`    Deleted ${relPath} (stale managed file)`);
          }
        }
      }
    }
    walkUser(userDir);

    // Remove empty directories left behind (within managed dirs only)
    removeEmptyDirs(userDir);
  }

  // Report backed-up files
  if (backedUp.length > 0) {
    console.log(`\n    Backed up ${backedUp.length} file(s) to ${path.relative(projectPath, backupDir)}/`);
  }

  // Report updated managed files
  if (updated.length > 0) {
    console.log('\n    Updated managed files:');
    for (const file of updated) {
      console.log(`      ${file}`);
    }
  }

  // Report changed templates
  if (changed.length > 0) {
    console.log('\n    Updated templates available (skipped — user-edited):');
    for (const file of changed) {
      console.log(`      ${file}`);
    }
  }
}

/**
 * Build thepopebot-base locally so the event-handler Dockerfile's
 * `FROM ${BASE_IMAGE}` (default: thepopebot-base) resolves. Cached layers
 * make this near-instant when nothing in docker/base changed.
 */
function buildBaseImage() {
  console.log('\n  Building thepopebot-base image...');
  const baseContext = path.join(PACKAGE_DIR, 'docker', 'base');
  execSync(`docker build -t thepopebot-base -f ${path.join(baseContext, 'Dockerfile')} ${baseContext}`, {
    stdio: 'inherit',
  });
}

function buildDockerImage(projectPath) {
  console.log('\n  Building Docker event handler image...');

  const dockerfilePath = path.join(PACKAGE_DIR, 'docker', 'event-handler', 'Dockerfile');
  let dockerfile = fs.readFileSync(dockerfilePath, 'utf8');

  // Add COPY for tarball after the package.json COPY line in builder stage
  const afterCopy = dockerfile.replace(
    'COPY package.json package-lock.json* ./',
    'COPY package.json package-lock.json* ./\nCOPY .thepopebot-dev.tgz /tmp/thepopebot.tgz'
  );
  if (afterCopy === dockerfile) {
    throw new Error('buildDockerImage: failed to patch Dockerfile — the "COPY package.json package-lock.json* ./" line was not found (Dockerfile may have drifted).');
  }
  dockerfile = afterCopy;

  // Replace npm install from registry with local tarball install
  const afterInstall = dockerfile.replace(
    /RUN TPB_VERSION=.*\n\s+echo.*\n\s+npm install --no-save "thepopebot@\$\{TPB_VERSION\}" tailwindcss @tailwindcss\/postcss/,
    'RUN echo \'{"private":true}\' > package.json && \\\n    npm install --no-save /tmp/thepopebot.tgz tailwindcss @tailwindcss/postcss && \\\n    rm /tmp/thepopebot.tgz'
  );
  if (afterInstall === dockerfile) {
    throw new Error('buildDockerImage: failed to patch Dockerfile — the registry npm install block was not found (Dockerfile may have drifted).');
  }
  dockerfile = afterInstall;

  // Read version from package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));
  const version = pkg.version;
  const imageTag = `stephengpope/thepopebot:event-handler-${version}`;

  // Copy web/ and docker/ to project for Docker build context
  const webSrc = path.join(PACKAGE_DIR, 'web');
  const webDest = path.join(projectPath, 'web');
  const dockerSrc = path.join(PACKAGE_DIR, 'docker');
  const dockerDest = path.join(projectPath, 'docker');
  // Only clean up directories we created — never delete pre-existing user content.
  const webPreexisted = fs.existsSync(webDest);
  const dockerPreexisted = fs.existsSync(dockerDest);
  fs.cpSync(webSrc, webDest, { recursive: true });
  fs.cpSync(dockerSrc, dockerDest, { recursive: true });

  try {
    execSync(`docker build -f - -t ${imageTag} .`, {
      input: dockerfile,
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: projectPath,
    });
  } finally {
    if (!webPreexisted) fs.rmSync(webDest, { recursive: true, force: true });
    if (!dockerPreexisted) fs.rmSync(dockerDest, { recursive: true, force: true });
  }

  // Clean up dangling images from previous builds
  try {
    execSync('docker image prune -f', { stdio: 'ignore' });
  } catch {}


  // Update THEPOPEBOT_VERSION in .env
  const envPath = path.join(projectPath, '.env');
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, 'utf8');
    if (env.match(/^THEPOPEBOT_VERSION=.*/m)) {
      env = env.replace(/^THEPOPEBOT_VERSION=.*/m, `THEPOPEBOT_VERSION=${version}`);
    } else {
      env = env.trimEnd() + `\nTHEPOPEBOT_VERSION=${version}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log(`  Updated THEPOPEBOT_VERSION to ${version}`);
  }
}

/**
 * Fast sync — skip Docker image rebuild entirely.
 *
 *   1. Build package JSX (npm run build)
 *   2. mirrorTemplates() — scaffold using init's managed-path logic
 *   3. docker cp package source (lib/, api/, config/, package.json) into
 *      the running container's /app/node_modules/thepopebot/
 *   4. docker cp web/app/ + web/postcss.config.mjs into container
 *   5. docker exec next build inside the container (tailwindcss already there)
 *   6. Clean up copied source from container
 *   7. docker exec pm2 restart all
 */
export async function syncFast(projectPath) {
  if (!projectPath) {
    console.error('\n  Usage: thepopebot sync --fast <path-to-project>\n');
    process.exit(1);
  }

  projectPath = path.resolve(projectPath);

  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    console.error(`\n  Not a project directory (no package.json): ${projectPath}\n`);
    process.exit(1);
  }

  // 1. Build JSX
  console.log('\n  Building package...');
  execSync('npm run build', { stdio: 'inherit', cwd: PACKAGE_DIR });

  // 2. Mirror templates
  console.log('\n  Mirroring templates...');
  mirrorTemplates(projectPath);

  // 3. Get running container ID
  const container = execFileSync('docker', ['compose', 'ps', '-q', 'event-handler'], {
    encoding: 'utf8',
    cwd: projectPath,
  }).trim();

  if (!container) {
    console.error('\n  event-handler container is not running. Use full sync instead.\n');
    process.exit(1);
  }

  // 4. Copy package source into container's node_modules/thepopebot/
  const PKG_DEST = '/app/node_modules/thepopebot';
  const PACKAGE_DIRS = ['lib', 'api', 'config'];

  console.log('\n  Copying package source into container...');
  for (const dir of PACKAGE_DIRS) {
    execFileSync('docker', ['exec', container, 'rm', '-rf', `${PKG_DEST}/${dir}`], { stdio: 'inherit' });
    execFileSync('docker', ['cp', path.join(PACKAGE_DIR, dir), `${container}:${PKG_DEST}/${dir}`], { stdio: 'inherit' });
  }
  // Also copy package.json for exports resolution
  execFileSync('docker', ['cp', path.join(PACKAGE_DIR, 'package.json'), `${container}:${PKG_DEST}/package.json`], { stdio: 'inherit' });

  // 5. Copy web/app/ source into container for next build
  const webDir = path.join(PACKAGE_DIR, 'web');
  console.log('\n  Copying web source into container...');
  execFileSync('docker', ['cp', path.join(webDir, 'app'), `${container}:/app/app`], { stdio: 'inherit' });
  execFileSync('docker', ['cp', path.join(webDir, 'postcss.config.mjs'), `${container}:/app/postcss.config.mjs`], { stdio: 'inherit' });
  execFileSync('docker', ['cp', path.join(webDir, 'next.config.mjs'), `${container}:/app/next.config.mjs`], { stdio: 'inherit' });

  // 6. Run next build inside the container
  // Hide data/logs dirs so webpack's FileSystemInfo doesn't crawl them (causes OOM/RangeError
  // when workspaces contain thousands of files). Restored immediately after build.
  console.log('\n  Building Next.js inside container...');
  execFileSync('docker', ['exec', container, 'sh', '-c', 'mv /app/data /app/.data-build-tmp 2>/dev/null; mv /app/logs /app/.logs-build-tmp 2>/dev/null; true'], { stdio: 'inherit' });
  try {
    execFileSync('docker', ['exec', container, './node_modules/.bin/next', 'build'], { stdio: 'inherit' });
  } finally {
    execFileSync('docker', ['exec', container, 'sh', '-c', 'mv /app/.data-build-tmp /app/data 2>/dev/null; mv /app/.logs-build-tmp /app/logs 2>/dev/null; true'], { stdio: 'inherit' });
  }

  // 7. Clean up web source from container (not needed at runtime)
  execFileSync('docker', ['exec', container, 'rm', '-rf', '/app/app'], { stdio: 'inherit' });

  // 8. Restart PM2
  console.log('\n  Restarting server...');
  execFileSync('docker', ['exec', container, 'pm2', 'restart', 'all'], { stdio: 'inherit' });

  console.log('\n  Fast synced!\n');
}

export async function sync(projectPath) {
  if (!projectPath) {
    console.error('\n  Usage: thepopebot sync <path-to-project>\n');
    process.exit(1);
  }

  projectPath = path.resolve(projectPath);

  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    console.error(`\n  Not a project directory (no package.json): ${projectPath}\n`);
    process.exit(1);
  }

  // 1. Build JSX
  console.log('\n  Building package...');
  execSync('npm run build', { stdio: 'inherit', cwd: PACKAGE_DIR });

  // 2. npm pack
  console.log('\n  Packing...');
  const packOutput = execSync('npm pack', { cwd: PACKAGE_DIR, encoding: 'utf8' }).trim();
  // npm pack may output warnings before the filename — tarball is always the last line
  const tarball = packOutput.split('\n').pop().trim();
  const tarballSrc = path.join(PACKAGE_DIR, tarball);
  const tarballDest = path.join(projectPath, '.thepopebot-dev.tgz');

  try {
    fs.copyFileSync(tarballSrc, tarballDest);
    fs.unlinkSync(tarballSrc);

    // 3. Mirror templates (hard overwrite + delete stale managed files)
    console.log('\n  Mirroring templates...');
    mirrorTemplates(projectPath);

    // 4. Install on host (--no-save so package.json keeps its registry reference)
    console.log('\n  Installing package on host...');
    execSync(`npm install --no-save ${tarballDest}`, { stdio: 'inherit', cwd: projectPath });

    // 5. Build thepopebot-base (event-handler Dockerfile FROMs it).
    //    Cached layers — fast unless docker/base/Dockerfile changed.
    buildBaseImage();

    // 6. Build event-handler image with patched Dockerfile (includes Next.js build)
    buildDockerImage(projectPath);

    // 6. Restart container with new image
    console.log('\n  Restarting event handler...');
    execSync('docker compose up -d -V event-handler', { stdio: 'inherit', cwd: projectPath });

  } finally {
    // 7. Cleanup
    try { fs.unlinkSync(tarballDest); } catch {}
    try { fs.unlinkSync(tarballSrc); } catch {}
  }

  console.log('\n  Synced!\n');
}
