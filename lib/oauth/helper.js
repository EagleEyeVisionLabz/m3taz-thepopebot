import { randomBytes } from 'crypto';
import { encrypt, decrypt } from '../db/crypto.js';
import { OAUTH_PROVIDERS } from './providers.js';

/**
 * Allowlist of token endpoints derived from the OAUTH_PROVIDERS preset table.
 * Built once at module load.
 */
const ALLOWED_TOKEN_URLS = new Set(
  Object.values(OAUTH_PROVIDERS)
    .map((provider) => provider.tokenUrl)
    .filter(Boolean),
);

/**
 * Validate an outbound URL before we POST client credentials to it.
 *
 * Mirrors the `isBlockedHost` SSRF guard in lib/actions.js: require https
 * (http is only permitted for localhost/loopback dev), and reject hostnames
 * that are IP literals in loopback / private (RFC1918) / link-local
 * (incl. 169.254.169.254) / unique-local ranges, plus known cloud-metadata
 * hostnames (metadata.google.internal). This stops a stored/redirected
 * tokenUrl from being steered at an internal-network endpoint as an SSRF /
 * credential-redirection primitive.
 *
 * Shared by exchangeCodeForToken and refreshOAuthToken.
 *
 * @param {string} url
 * @returns {string} the validated url
 */
export function assertSafeOutboundUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Invalid tokenUrl');
  }

  // Exact match against a known provider preset is always allowed.
  if (ALLOWED_TOKEN_URLS.has(url)) {
    return url;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid tokenUrl');
  }

  const host = parsed.hostname.toLowerCase();
  // Strip brackets from IPv6 literals for inspection.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  const isLoopbackHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    bareHost === '::1' ||
    bareHost === '0:0:0:0:0:0:0:1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bareHost);

  if (parsed.protocol === 'http:') {
    // Allow plain http only for explicit localhost/loopback dev endpoints.
    if (!isLoopbackHost) {
      throw new Error('tokenUrl must use https');
    }
    return url;
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('tokenUrl must use https');
  }

  // Block obvious internal/loopback hostnames and cloud-metadata names.
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === '0.0.0.0' ||
    host === '[::]'
  ) {
    throw new Error('tokenUrl host is not allowed');
  }

  // IPv4-mapped IPv6. Node normalizes these to the compressed hex form, e.g.
  // ::ffff:169.254.169.254 → ::ffff:a9fe:a9fe, so handle both the dotted-quad
  // and the two-hextet hex encodings.
  let ipForCheck = bareHost;
  const mappedDotted = bareHost.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  const mappedHex = bareHost.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedDotted) {
    ipForCheck = mappedDotted[1];
  } else if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    ipForCheck = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  // IPv4 literal: block loopback / private / link-local / unspecified ranges.
  const ipv4 = ipForCheck.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 0 || // 0.0.0.0/8 (unspecified)
      a === 127 || // loopback
      a === 10 || // private
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 169 && b === 254) || // link-local (incl. 169.254.169.254 metadata)
      a >= 224 // multicast / reserved
    ) {
      throw new Error('tokenUrl host is not allowed');
    }
  }

  // IPv6 loopback / unspecified / unique-local / link-local literals.
  if (
    bareHost === '::1' ||
    bareHost === '::' ||
    bareHost.startsWith('fc') ||
    bareHost.startsWith('fd') ||
    bareHost.startsWith('fe80')
  ) {
    throw new Error('tokenUrl host is not allowed');
  }

  return url;
}

/**
 * Create an encrypted OAuth state parameter.
 *
 * Packs secret name, client credentials, token URL, secret type, and return
 * path into an AES-256-GCM encrypted base64url string. This travels through
 * the OAuth redirect and back to our callback untouched.
 */
export function createOAuthState({ secretName, clientId, clientSecret, tokenUrl, secretType, returnPath }) {
  // nonce: anti-replay/CSRF marker. iat: issued-at (ms) so the callback can
  // reject stale states. Added internally — the exported signature is unchanged.
  const nonce = randomBytes(16).toString('hex');
  const iat = Date.now();
  const payload = JSON.stringify({ secretName, clientId, clientSecret, tokenUrl, secretType, returnPath, nonce, iat });
  const encrypted = encrypt(payload);
  return Buffer.from(encrypted).toString('base64url');
}

/**
 * Decrypt an OAuth state parameter back to the original payload.
 */
export function parseOAuthState(stateString) {
  const encrypted = Buffer.from(stateString, 'base64url').toString();
  const decrypted = decrypt(encrypted);
  return JSON.parse(decrypted);
}

/**
 * Exchange an authorization code for tokens.
 *
 * POSTs to the provider's token endpoint with grant_type=authorization_code.
 * Returns the full JSON response (access_token, refresh_token, expires_in, etc.).
 */
export async function exchangeCodeForToken({ code, clientId, clientSecret, tokenUrl, redirectUri }) {
  assertSafeOutboundUrl(tokenUrl);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.error_description || data.error || 'Token exchange failed';
    throw new Error(errorMsg);
  }

  if (!data.access_token) {
    throw new Error('No access_token in token response');
  }

  return data;
}

/**
 * Refresh an OAuth2 access token using a refresh token.
 *
 * POSTs to the provider's token endpoint with grant_type=refresh_token.
 * Returns the full JSON response (new access_token, possibly new refresh_token, etc.).
 */
export async function refreshOAuthToken({ refreshToken, clientId, clientSecret, tokenUrl }) {
  assertSafeOutboundUrl(tokenUrl);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.error_description || data.error || 'Token refresh failed';
    throw new Error(errorMsg);
  }

  if (!data.access_token) {
    throw new Error('No access_token in refresh response');
  }

  return data;
}
