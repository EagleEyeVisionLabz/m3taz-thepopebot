import { redeemCode } from '../../db/user-channels.js';

// ── Per-chat verify throttle ────────────────────────────────────────────────
// In-memory sliding window keyed by channel:chatId. Caps how fast a single chat
// can submit /verify attempts so an unbound chat can't blindly brute-force codes
// (codes are 128-bit, but this bounds the attempt rate regardless). State is
// per-process and best-effort — it resets on restart, which is acceptable for a
// rate limiter layered on top of high-entropy codes + per-code attempt burning.
const THROTTLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_MAX_ATTEMPTS = 10; // attempts per chat per window
const _verifyAttempts = new Map(); // key -> number[] (timestamps)

/**
 * Record an attempt and report whether the chat is over its rate limit.
 * @param {string} key
 * @returns {boolean} true if the caller is throttled (should be rejected)
 */
function isVerifyThrottled(key) {
  const nowMs = Date.now();
  const cutoff = nowMs - THROTTLE_WINDOW_MS;
  const recent = (_verifyAttempts.get(key) || []).filter((t) => t > cutoff);
  recent.push(nowMs);
  _verifyAttempts.set(key, recent);

  // Opportunistic cleanup so the map can't grow unbounded across many chats.
  if (_verifyAttempts.size > 5000) {
    for (const [k, times] of _verifyAttempts) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) _verifyAttempts.delete(k);
      else _verifyAttempts.set(k, live);
    }
  }

  return recent.length > THROTTLE_MAX_ATTEMPTS;
}

/**
 * /verify <code>
 * Pre-auth: binds the incoming channel chat to the user who issued the code.
 */
export async function verifyCommand({ args, ctx }) {
  const [code] = args;
  if (!code) {
    return { handled: true, reply: 'Usage: /verify <code>' };
  }

  // Per-chat throttle: bound the attempt rate before touching the DB.
  const throttleKey = `${ctx.channel}:${ctx.channelChatId}`;
  if (isVerifyThrottled(throttleKey)) {
    console.warn(`[verify] throttled chat ${throttleKey}`);
    return { handled: true, reply: 'Too many attempts. Please wait a few minutes and try again.' };
  }

  try {
    const { userId } = redeemCode(ctx.channel, code, ctx.channelChatId);
    return { handled: true, reply: 'Linked. Send a message to start chatting.', userId };
  } catch (err) {
    // Log the specific reason server-side only; return a single generic message
    // to the sender so distinct errors can't be used as a code-enumeration oracle.
    console.error('[verify] redeemCode failed:', err.message);
    return { handled: true, reply: 'Verification failed or code expired.' };
  }
}
