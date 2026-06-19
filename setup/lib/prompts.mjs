import * as clack from '@clack/prompts';
import open from 'open';
import { canOpenBrowser } from './prerequisites.mjs';

/**
 * Open a URL in the browser, or print it if in a headless/SSH session
 */
export async function openOrShowURL(url, label) {
  if (canOpenBrowser()) {
    const shouldOpen = handleCancel(await clack.confirm({
      message: `Open ${label} in browser?`,
      initialValue: true,
    }));
    if (shouldOpen) await open(url);
  } else {
    clack.log.info(`${label}:\n\n  ${url}\n`);
    await pressEnter();
  }
}

/**
 * Mask a secret, showing only last 4 characters
 */
export function maskSecret(secret) {
  if (!secret || secret.length < 8) return '****';
  return '****' + secret.slice(-4);
}

/**
 * Handle cancel — exits cleanly if user pressed Ctrl+C
 */
function handleCancel(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  return value;
}

/**
 * Boolean gate — returns true (keep existing) or false (must configure).
 * If no displayValue, returns false (must configure).
 */
export async function keepOrReconfigure(label, displayValue) {
  if (!displayValue) return false;
  clack.log.success(`${label}: ${displayValue}`);
  const reconfig = handleCancel(await clack.confirm({
    message: 'Reconfigure?',
    initialValue: false,
  }));
  return !reconfig;
}

/**
 * Prompt for GitHub PAT
 */
export async function promptForPAT() {
  const pat = handleCancel(await clack.password({
    message: 'Paste your GitHub Personal Access Token:',
    validate: (input) => {
      if (!input) return 'PAT is required';
      if (!input.startsWith('ghp_') && !input.startsWith('github_pat_')) {
        return 'Invalid PAT format. Should start with ghp_ or github_pat_';
      }
    },
  }));
  return pat;
}

/**
 * Prompt for confirmation (wraps clack.confirm with cancel handling)
 */
export async function confirm(message, initialValue = true) {
  const result = handleCancel(await clack.confirm({
    message,
    initialValue,
  }));
  return result;
}

/**
 * Press enter to continue
 */
export async function pressEnter(message = 'Press enter to continue') {
  handleCancel(await clack.text({
    message,
    defaultValue: '',
  }));
}
