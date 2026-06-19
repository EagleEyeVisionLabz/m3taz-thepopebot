import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = process.cwd();

/**
 * Update a single variable in an existing .env file
 */
export function updateEnvVariable(key, value) {
  const envPath = join(ROOT_DIR, '.env');
  if (!existsSync(envPath)) {
    throw new Error('.env file not found. Run npm run setup first.');
  }

  // Strip CR/LF so a value cannot inject additional .env lines (newline injection).
  const safeValue = String(value).replace(/[\r\n]/g, '');

  let content = readFileSync(envPath, 'utf-8');
  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    // Function replacement avoids interpreting `$`-patterns ($&, $1, $`, $') in the value.
    content = content.replace(regex, () => `${key}=${safeValue}`);
  } else {
    content = content.trimEnd() + `\n${key}=${safeValue}\n`;
  }

  writeFileSync(envPath, content);
  return envPath;
}
