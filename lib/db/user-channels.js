import { randomUUID, randomBytes } from 'crypto';
import { and, eq, isNotNull, asc } from 'drizzle-orm';
import { getDb } from './index.js';
import { userChannels } from './schema.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_BYTES = 16;
// After this many failed redemption attempts against a pending code, the code is
// invalidated (cleared) so it can no longer be redeemed even if guessed later.
const MAX_CODE_ATTEMPTS = 5;

function now() {
  return Date.now();
}

function generateCode() {
  return randomBytes(CODE_BYTES).toString('hex').toUpperCase();
}

export function getUserChannel(userId, channel) {
  const db = getDb();
  return db
    .select()
    .from(userChannels)
    .where(and(eq(userChannels.userId, userId), eq(userChannels.channel, channel)))
    .get();
}

export function getVerifiedChannels(userId) {
  const db = getDb();
  return db
    .select()
    .from(userChannels)
    .where(and(eq(userChannels.userId, userId), isNotNull(userChannels.verifiedAt)))
    .orderBy(asc(userChannels.verifiedAt))
    .all();
}

export function getByChannelChatId(channel, channelChatId) {
  const db = getDb();
  return db
    .select()
    .from(userChannels)
    .where(and(eq(userChannels.channel, channel), eq(userChannels.channelChatId, channelChatId)))
    .get();
}

export function getByCode(code) {
  const db = getDb();
  return db.select().from(userChannels).where(eq(userChannels.code, code)).get();
}

/**
 * Issue or re-issue a verification code for a user+channel.
 * Creates the row if absent; overwrites the code if present and still pending.
 * Throws if the row is already verified — caller should unlink first.
 */
export function issueCode(userId, channel) {
  const db = getDb();
  const existing = getUserChannel(userId, channel);
  const code = generateCode();
  const codeExpiresAt = now() + CODE_TTL_MS;
  const timestamp = now();

  if (existing) {
    if (existing.verifiedAt) {
      throw new Error('Channel already verified — unlink before re-issuing a code');
    }
    db.update(userChannels)
      .set({ code, codeExpiresAt, codeAttempts: 0, updatedAt: timestamp })
      .where(eq(userChannels.id, existing.id))
      .run();
    return { ...existing, code, codeExpiresAt, codeAttempts: 0, updatedAt: timestamp };
  }

  const row = {
    id: randomUUID(),
    userId,
    channel,
    channelChatId: null,
    code,
    codeExpiresAt,
    codeAttempts: 0,
    verifiedAt: null,
    activeThreadId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.insert(userChannels).values(row).run();
  return row;
}

/**
 * Redeem a code from an incoming channel message.
 * Returns the userId on success. Throws on expired, already-consumed, or chat-taken.
 */
export function redeemCode(channel, code, channelChatId) {
  const db = getDb();
  const row = getByCode(code);
  // Use a single generic message for all code-validation failures so distinct
  // error strings can't be used to enumerate/probe pending codes.
  if (!row || row.channel !== channel) throw new Error('Invalid or expired code');
  if (row.verifiedAt) throw new Error('Invalid or expired code');
  if (row.codeExpiresAt && row.codeExpiresAt < now()) throw new Error('Invalid or expired code');

  const chatTaken = getByChannelChatId(channel, channelChatId);
  if (chatTaken && chatTaken.id !== row.id) {
    // A valid code was presented from a chat already bound to someone else.
    // Count this against the code and burn it after too many failures so a
    // leaked code can't be hammered from a hijacked/foreign chat.
    const attempts = (row.codeAttempts || 0) + 1;
    const timestamp = now();
    if (attempts >= MAX_CODE_ATTEMPTS) {
      db.update(userChannels)
        .set({ code: null, codeExpiresAt: null, codeAttempts: attempts, updatedAt: timestamp })
        .where(eq(userChannels.id, row.id))
        .run();
    } else {
      db.update(userChannels)
        .set({ codeAttempts: attempts, updatedAt: timestamp })
        .where(eq(userChannels.id, row.id))
        .run();
    }
    throw new Error('This chat is already linked to another user');
  }

  const timestamp = now();
  db.update(userChannels)
    .set({
      channelChatId,
      code: null,
      codeExpiresAt: null,
      codeAttempts: 0,
      verifiedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(userChannels.id, row.id))
    .run();
  return { userId: row.userId, rowId: row.id };
}

export function setActiveThread(userId, channel, threadId) {
  const db = getDb();
  const timestamp = now();
  db.update(userChannels)
    .set({ activeThreadId: threadId, updatedAt: timestamp })
    .where(
      and(
        eq(userChannels.userId, userId),
        eq(userChannels.channel, channel),
        isNotNull(userChannels.verifiedAt)
      )
    )
    .run();
}

export function unlink(userId, channel) {
  const db = getDb();
  db.delete(userChannels)
    .where(and(eq(userChannels.userId, userId), eq(userChannels.channel, channel)))
    .run();
}

/**
 * Toggle whether system messages (e.g. github webhook notifications) are pushed
 * to this user's channel. Inbox row is always written regardless of this flag —
 * only the channel push is gated.
 */
export function setSystemMessagesEnabled(userId, channel, enabled) {
  const db = getDb();
  db.update(userChannels)
    .set({ systemMessagesEnabled: enabled ? 1 : 0, updatedAt: now() })
    .where(and(eq(userChannels.userId, userId), eq(userChannels.channel, channel)))
    .run();
}
