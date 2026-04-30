import { randomUUID } from 'crypto';
import { eq, desc, sql, and, isNull } from 'drizzle-orm';
import { getDb } from './index.js';
import { messages, users } from './schema.js';

/**
 * Create a system message (DM/notification) addressed to a single user.
 * Sets chatId=null and role='system'. Caller is responsible for delivery.
 * @param {string} userId - Recipient user id
 * @param {string} content - Message body
 * @param {object} [payload] - Structured payload (e.g., {url, ...})
 * @returns {object} The created message row
 */
export function createSystemMessage(userId, content, payload) {
  const db = getDb();
  const now = Date.now();
  const row = {
    id: randomUUID(),
    chatId: null,
    userId,
    role: 'system',
    content,
    payload: payload ? JSON.stringify(payload) : null,
    read: 0,
    deliveredAt: null,
    createdAt: now,
  };
  db.insert(messages).values(row).run();
  return row;
}

/**
 * Get the user ids of all admins subscribed to system broadcasts.
 * @returns {string[]}
 */
export function getSubscribedAdminIds() {
  const db = getDb();
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.subscribedToSystemMessages, 1)))
    .all()
    .map((r) => r.id);
}

/**
 * Mark a message row as delivered (push to default channel succeeded).
 * @param {string} id
 */
export function markDelivered(id) {
  const db = getDb();
  db.update(messages).set({ deliveredAt: Date.now() }).where(eq(messages.id, id)).run();
}

/**
 * Get inbox messages for a user (system DMs only — chat history excluded).
 * Newest first, with pagination.
 * @param {string} userId
 * @param {{ unreadOnly?: boolean, limit?: number, offset?: number }} [opts]
 */
export function getMessagesForUser(userId, { unreadOnly = false, limit = 25, offset = 0 } = {}) {
  const db = getDb();
  const where = unreadOnly
    ? and(eq(messages.userId, userId), isNull(messages.chatId), eq(messages.read, 0))
    : and(eq(messages.userId, userId), isNull(messages.chatId));
  return db
    .select()
    .from(messages)
    .where(where)
    .orderBy(desc(messages.createdAt))
    .limit(limit + 1)
    .offset(offset)
    .all();
}

/**
 * Count unread system DMs for a user (drives the sidebar badge).
 * @param {string} userId
 * @returns {number}
 */
export function getUnreadCountForUser(userId) {
  const db = getDb();
  const result = db
    .select({ count: sql`count(*)` })
    .from(messages)
    .where(and(eq(messages.userId, userId), isNull(messages.chatId), eq(messages.read, 0)))
    .get();
  return result?.count ?? 0;
}

/**
 * Mark a single message read. Verifies ownership in the WHERE clause.
 * @param {string} id
 * @param {string} userId
 * @returns {boolean} True if a row was updated
 */
export function markMessageRead(id, userId) {
  const db = getDb();
  const result = db
    .update(messages)
    .set({ read: 1 })
    .where(and(eq(messages.id, id), eq(messages.userId, userId)))
    .run();
  return result.changes > 0;
}

/**
 * Mark every system DM for this user as read.
 * @param {string} userId
 */
export function markAllReadForUser(userId) {
  const db = getDb();
  db.update(messages)
    .set({ read: 1 })
    .where(and(eq(messages.userId, userId), isNull(messages.chatId), eq(messages.read, 0)))
    .run();
}
