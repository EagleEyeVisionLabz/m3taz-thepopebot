import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const ITERATIONS = 100_000;

// Pre-v1 records were encrypted with this single static salt. Kept ONLY so old
// ciphertext still decrypts; new records use a random per-record salt.
const LEGACY_SALT = 'thepopebot-config-v1';
const ENVELOPE_VERSION = 1;

// Cache derived keys by (secret, salt) so per-record salts don't cost a PBKDF2
// round on every read. Keyed by string so it survives AUTH_SECRET rotation.
const _keyCache = new Map();

function requireSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET environment variable is required for encryption');
  }
  return secret;
}

/**
 * Derive a 256-bit key from a secret + salt (PBKDF2-SHA256), cached.
 * @param {string} secret
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(secret, salt) {
  const cacheKey = `${secret}:${salt.toString('base64')}`;
  let key = _keyCache.get(cacheKey);
  if (!key) {
    key = pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, 'sha256');
    _keyCache.set(cacheKey, key);
  }
  return key;
}

/**
 * Encrypt plaintext using AES-256-GCM with a random per-record salt.
 * @param {string} plaintext
 * @returns {string} JSON envelope { v, salt, iv, ciphertext, tag }
 */
export function encrypt(plaintext) {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(requireSecret(), salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  });
}

/**
 * Decrypt an AES-256-GCM envelope produced by encrypt().
 *
 * Backward compatible: legacy envelopes (no `salt`/`v`) decrypt with the static
 * LEGACY_SALT. Rotation: if decryption fails under AUTH_SECRET and
 * AUTH_SECRET_PREVIOUS is set, it is tried too — so AUTH_SECRET can be rotated
 * and secrets re-saved gradually instead of all breaking at once.
 *
 * @param {string} encryptedJson - JSON envelope from encrypt()
 * @returns {string} plaintext
 */
export function decrypt(encryptedJson) {
  const { iv, ciphertext, tag, salt: saltB64 } = JSON.parse(encryptedJson);

  // v>=1 envelopes carry a per-record salt; legacy ones used the static salt.
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : Buffer.from(LEGACY_SALT);
  const ivBuf = Buffer.from(iv, 'base64');
  const tagBuf = Buffer.from(tag, 'base64');
  const ctBuf = Buffer.from(ciphertext, 'base64');

  const secrets = [requireSecret()];
  if (process.env.AUTH_SECRET_PREVIOUS) secrets.push(process.env.AUTH_SECRET_PREVIOUS);

  let lastErr;
  for (const secret of secrets) {
    try {
      const key = deriveKey(secret, salt);
      const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
      decipher.setAuthTag(tagBuf);
      return Buffer.concat([decipher.update(ctBuf), decipher.final()]).toString('utf8');
    } catch (err) {
      lastErr = err; // try next secret (rotation window) before giving up
    }
  }
  throw lastErr;
}
