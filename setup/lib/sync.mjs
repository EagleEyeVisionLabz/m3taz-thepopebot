import * as clack from '@clack/prompts';
import { updateEnvVariable } from './auth.mjs';
import { setSecret, setVariable } from './github.mjs';
import { CONFIG_TARGETS } from './targets.mjs';

/**
 * Sync collected config values to .env, DB, and GitHub.
 *
 * Only keys present in `collected` are considered.
 * Only values that actually changed (vs `env`) are written.
 *
 * @param {object|null} env - Current .env values (null if no .env)
 * @param {object} collected - All collected config values
 * @param {object} options
 * @param {string} options.owner - GitHub owner
 * @param {string} options.repo - GitHub repo
 * @returns {Promise<object>} Sync report
 */
export async function syncConfig(env, collected, { owner, repo }) {
  const envUpdates = [];
  const dbUpdates = [];
  const dbSecretUpdates = [];
  const secretUpdates = [];
  const variableUpdates = [];
  const isFirstRun = !env?.GH_OWNER;

  // For keys not mirrored to .env (dbSecret/secret/db-only), the current value
  // lives in the settings DB, not in `env`. Read it so unchanged secrets aren't
  // needlessly re-written to the DB and re-pushed to GitHub on every run.
  // Guarded: if the DB isn't readable yet, fall back to the .env comparison.
  let dbConfig = null;
  try {
    dbConfig = await import('../../lib/db/config.js');
  } catch {
    dbConfig = null;
  }
  const getStoredValue = (target, key) => {
    if (!dbConfig) return undefined;
    try {
      if (target.dbSecret) return dbConfig.getConfigSecret(key);
      if (target.db) return dbConfig.getConfigValue(key);
    } catch {
      return undefined;
    }
    return undefined;
  };

  for (const [key, value] of Object.entries(collected)) {
    const target = CONFIG_TARGETS[key];
    if (!target) continue;

    let oldValue = env?.[key] ?? '';
    // When the key isn't stored in .env, compare against the DB-stored value.
    if (!target.env) {
      const stored = getStoredValue(target, key);
      if (stored != null) oldValue = stored;
    }
    const changed = value !== oldValue;

    // .env — write if changed and target has env: true
    if (target.env && changed) {
      envUpdates.push({ key, value });
    }

    // DB plain config
    if (target.db && changed && value) {
      dbUpdates.push({ key, value });
    }

    // DB encrypted secret
    if (target.dbSecret && changed && value) {
      dbSecretUpdates.push({ key, value });
    }

    // GitHub secret — only if changed AND value is non-empty
    if (target.secret && changed && value) {
      const secretName = target.secret === true ? key : target.secret;
      secretUpdates.push({ key, secretName, value });
    }

    // GitHub variable — only if changed
    if (target.variable && changed) {
      // Skip firstRunOnly variables unless this is the first setup
      if (target.firstRunOnly && !isFirstRun) continue;
      variableUpdates.push({ key, value });
    }
  }

  // Also handle firstRunOnly defaults that aren't in collected
  if (isFirstRun) {
    for (const [key, target] of Object.entries(CONFIG_TARGETS)) {
      if (target.firstRunOnly && target.default && !(key in collected)) {
        variableUpdates.push({ key, value: target.default });
      }
    }
  }

  const report = { env: [], db: [], secrets: [], variables: [], errors: [] };

  if (envUpdates.length === 0 && dbUpdates.length === 0 && dbSecretUpdates.length === 0
    && secretUpdates.length === 0 && variableUpdates.length === 0) {
    clack.log.info('Config unchanged');
    return report;
  }

  const s = clack.spinner();

  // Write .env updates
  if (envUpdates.length > 0) {
    for (const { key, value } of envUpdates) {
      updateEnvVariable(key, value);
      report.env.push(key);
    }
    clack.log.success(`Updated .env (${report.env.join(', ')})`);
  }

  // Write DB config values
  if (dbUpdates.length > 0 || dbSecretUpdates.length > 0) {
    s.start('Saving settings to database...');
    try {
      const { setConfigValue, setConfigSecret } = await import('../../lib/db/config.js');

      for (const { key, value } of dbUpdates) {
        setConfigValue(key, value, 'setup');
        report.db.push(key);
      }

      for (const { key, value } of dbSecretUpdates) {
        setConfigSecret(key, value, 'setup');
        report.db.push(key);
      }

      s.stop(`Saved to database (${report.db.join(', ')})`);
    } catch (err) {
      s.stop('Failed to save to database');
      clack.log.error(`Database error: ${err.message}`);
      report.errors.push(`Database: ${err.message}`);
    }
  }

  // Set GitHub secrets
  if (secretUpdates.length > 0) {
    s.start('Setting GitHub secrets...');
    let allOk = true;
    for (const { key, secretName, value } of secretUpdates) {
      const result = await setSecret(owner, repo, secretName, value);
      if (result.success) {
        report.secrets.push(secretName);
      } else {
        report.errors.push(`Failed to set secret ${secretName}: ${result.error}`);
        allOk = false;
      }
    }
    if (allOk) {
      s.stop('GitHub secrets set');
    } else {
      s.stop('Some secrets failed');
      for (const err of report.errors) {
        clack.log.error(err);
      }
    }
  }

  // Set GitHub variables
  if (variableUpdates.length > 0) {
    s.start('Setting GitHub variables...');
    let allOk = true;
    for (const { key, value } of variableUpdates) {
      const result = await setVariable(owner, repo, key, value);
      if (result.success) {
        report.variables.push(key);
      } else {
        report.errors.push(`Failed to set variable ${key}: ${result.error}`);
        allOk = false;
      }
    }
    if (allOk) {
      s.stop('GitHub variables set');
    } else {
      s.stop('Some variables failed');
      for (const err of report.errors) {
        clack.log.error(err);
      }
    }
  }

  return report;
}
