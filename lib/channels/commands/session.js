import { randomUUID } from 'crypto';
import { setActiveThread } from '../../db/user-channels.js';
import { getChatById, getChatsByUser } from '../../db/chats.js';

function shortId(id) {
  return id.replace(/-/g, '').slice(0, 8);
}

/**
 * /session           → mint a new session UUID, mark it active
 * /session list      → list the user's 10 most-recent chats
 * /session <id|short> → switch active to an existing chat (full uuid or 8-char short id)
 */
export async function sessionCommand({ args, ctx }) {
  const sub = args[0];

  if (!sub) {
    const threadId = randomUUID();
    setActiveThread(ctx.userId, ctx.channel, threadId);
    return {
      handled: true,
      reply: `New session: ${shortId(threadId)}\nSend a message to begin.`,
    };
  }

  if (sub.toLowerCase() === 'list') {
    const chats = getChatsByUser(ctx.userId).slice(0, 10);
    if (!chats.length) {
      return { handled: true, reply: 'No sessions yet. Send a message or use /session to start one.' };
    }
    const lines = chats.map((c) => `${shortId(c.id)}  ${c.title}`);
    return { handled: true, reply: `Recent sessions:\n${lines.join('\n')}` };
  }

  const target = resolveChatId(sub, ctx.userId);
  if (!target) {
    return { handled: true, reply: `Session not found: ${sub}` };
  }
  setActiveThread(ctx.userId, ctx.channel, target.id);
  return { handled: true, reply: `Switched to session: ${shortId(target.id)}\n${target.title}` };
}

function resolveChatId(input, userId) {
  // Full UUID match first
  const direct = getChatById(input);
  if (direct && direct.userId === userId) return direct;
  // Short-id match (8-char prefix of UUID minus dashes).
  // NOTE: getChatsByUser() is unbounded — it materializes the user's entire
  // chat history, then we linear-scan it for the prefix. This is an O(all-chats)
  // memory load on every short-id /session switch. A bounded/indexed lookup
  // (e.g. a getChatsByUser limit, or a SQL id-prefix filter in lib/db/chats.js)
  // would remove this footgun, but that requires a cross-file DB change.
  if (input.length === 8) {
    const chats = getChatsByUser(userId);
    return chats.find((c) => shortId(c.id) === input.toLowerCase()) || null;
  }
  return null;
}
