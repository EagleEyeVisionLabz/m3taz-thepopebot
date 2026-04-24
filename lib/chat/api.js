import { auth } from '../auth/index.js';
import { chatStream } from '../ai/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * POST handler for /stream/chat — streaming chat with session auth.
 * Dedicated route handler separate from the catch-all api/index.js.
 */
export async function POST(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { messages, chatId: rawChatId, trigger, codeMode, repo, branch, workspaceId, codeModeType, scope } = body;

  if (!messages?.length) {
    return Response.json({ error: 'No messages' }, { status: 400 });
  }

  // Get the last user message — AI SDK v5 sends UIMessage[] with parts
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    return Response.json({ error: 'No user message' }, { status: 400 });
  }

  // Extract text from message parts (AI SDK v5+) or fall back to content
  let userText =
    lastUserMessage.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ||
    lastUserMessage.content ||
    '';

  // Extract file parts from message
  const fileParts = lastUserMessage.parts?.filter((p) => p.type === 'file') || [];
  const attachments = [];

  for (const part of fileParts) {
    const { mediaType, url } = part;
    if (!mediaType || !url) continue;

    if (mediaType.startsWith('image/') || mediaType === 'application/pdf') {
      // Images and PDFs → pass as visual attachments for the LLM
      attachments.push({ category: 'image', mimeType: mediaType, dataUrl: url });
    } else if (mediaType.startsWith('text/') || mediaType === 'application/json') {
      // Text files → decode base64 data URL and inline into message text
      try {
        const base64Data = url.split(',')[1];
        const textContent = Buffer.from(base64Data, 'base64').toString('utf-8');
        const fileName = part.name || 'file';
        userText += `\n\nFile: ${fileName}\n\`\`\`\n${textContent}\n\`\`\``;
      } catch (e) {
        console.error('Failed to decode text file:', e);
      }
    }
  }

  if (!userText.trim() && attachments.length === 0) {
    return Response.json({ error: 'Empty message' }, { status: 400 });
  }

  // Map web channel to thread_id — AI layer handles DB persistence
  const threadId = rawChatId || uuidv4();
  const { createUIMessageStream, createUIMessageStreamResponse } = await import('ai');

  const stream = createUIMessageStream({
    onError: (error) => {
      console.error('Chat stream error:', error);
      return error?.message || 'An error occurred while processing your message.';
    },
    execute: async ({ writer }) => {
      // chatStream handles: save user msg, invoke agent, save assistant msg, auto-title
      const skipUserPersist = trigger === 'regenerate-message';
      // Always pass workspace context — derive defaults for agent mode
      const effectiveRepo = repo || (process.env.GH_OWNER && process.env.GH_REPO ? `${process.env.GH_OWNER}/${process.env.GH_REPO}` : '');
      const effectiveBranch = branch || 'main';
      const streamOptions = {
        userId: session.user.id,
        skipUserPersist,
        codeMode: !!codeMode,
        repo: effectiveRepo,
        branch: effectiveBranch,
        codeModeType: codeModeType || 'plan',
      };
      if (workspaceId) streamOptions.workspaceId = workspaceId;
      if (scope) streamOptions.scope = scope;
      const chunks = chatStream(threadId, userText, attachments, streamOptions);

      // Signal start of assistant message
      writer.write({ type: 'start' });

      let textStarted = false;
      let textId = uuidv4();
      // Ephemeral thinking block state — tunneled as __thinking__ tool calls.
      // Content is never persisted to DB (not a real tool-call/result pair in chatStream).
      let thinkingId = null;
      let thinkingText = '';
      // Track which toolCallIds have had tool-input-start emitted.
      //
      // Two problems this solves:
      //
      // 1. The Claude Agent SDK emits tool-call twice per tool use: once at
      //    content_block_start (args: {}) and again at content_block_stop
      //    (args: complete). Sending tool-input-start twice for the same ID
      //    resets the AI SDK's internal part state to input-streaming and
      //    clears its stored input, causing a visual flicker. Deduplicate here.
      //
      // 2. When Claude Code resumes a session, the adapter skips assistant
      //    messages (to avoid duplicate UI) but still emits tool-result chunks
      //    for tool_result blocks in subsequent user messages. Those tool-result
      //    chunks have no matching tool-call in this stream, so tool-input-start
      //    is never sent for them. The AI SDK then throws
      //    "tool-output-error must be preceded by a tool-input-available"
      //    when tool-output-available arrives. Emit the open events defensively.
      const openedToolCalls = new Set();

      for await (const chunk of chunks) {
        if (chunk.type === 'text') {
          if (!textStarted) {
            textId = uuidv4();
            writer.write({ type: 'text-start', id: textId });
            textStarted = true;
          }
          writer.write({ type: 'text-delta', id: textId, delta: chunk.text });

        } else if (chunk.type === 'tool-call') {
          if (!openedToolCalls.has(chunk.toolCallId)) {
            // First time seeing this ID — open the tool block
            if (textStarted) {
              writer.write({ type: 'text-end', id: textId });
              textStarted = false;
            }
            writer.write({
              type: 'tool-input-start',
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
            });
            openedToolCalls.add(chunk.toolCallId);
          }
          // Always emit tool-input-available: first call shows empty args while
          // streaming, second call (content_block_stop) updates to complete args
          writer.write({
            type: 'tool-input-available',
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.args,
          });

        } else if (chunk.type === 'tool-result') {
          if (!openedToolCalls.has(chunk.toolCallId)) {
            // tool-result arrived with no preceding tool-call in this stream
            // (session resume replays tool results from skipped assistant messages).
            // Emit the required open events so the AI SDK does not throw.
            if (textStarted) {
              writer.write({ type: 'text-end', id: textId });
              textStarted = false;
            }
            writer.write({
              type: 'tool-input-start',
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName || 'unknown',
            });
            writer.write({
              type: 'tool-input-available',
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName || 'unknown',
              input: chunk.args || {},
            });
            openedToolCalls.add(chunk.toolCallId);
          }
          writer.write({
            type: 'tool-output-available',
            toolCallId: chunk.toolCallId,
            output: chunk.result,
          });

        } else if (chunk.type === 'thinking-start') {
          // Open a new ephemeral thinking block as a pseudo-tool
          if (textStarted) {
            writer.write({ type: 'text-end', id: textId });
            textStarted = false;
          }
          thinkingId = uuidv4();
          thinkingText = '';
          writer.write({
            type: 'tool-input-start',
            toolCallId: thinkingId,
            toolName: '__thinking__',
          });

        } else if (chunk.type === 'thinking') {
          // Accumulate and stream thinking deltas progressively
          if (thinkingId) {
            thinkingText += chunk.delta;
            writer.write({
              type: 'tool-input-available',
              toolCallId: thinkingId,
              toolName: '__thinking__',
              input: thinkingText,
            });
          }

        } else if (chunk.type === 'thinking-end') {
          // Close the thinking block — empty output marks it done
          if (thinkingId) {
            writer.write({
              type: 'tool-output-available',
              toolCallId: thinkingId,
              output: '',
            });
            thinkingId = null;
            thinkingText = '';
          }

        } else if (chunk.type === 'meta' || chunk.type === 'result') {
          // Internal events — no SSE output needed

        } else if (chunk.type === 'error') {
          // Stream a typed data part so the client renders a red error message.
          // Persisted by chatStream() as a JSON row — rehydrated in chat-page.jsx.
          if (textStarted) {
            writer.write({ type: 'text-end', id: textId });
            textStarted = false;
          }
          writer.write({
            type: 'data-error',
            id: `error-${uuidv4().slice(0, 8)}`,
            data: { message: chunk.message },
          });

        } else if (chunk.type === 'unknown') {
          // Close any open text block before unknown event
          if (textStarted) {
            writer.write({ type: 'text-end', id: textId });
            textStarted = false;
          }
          // Emit as a tool call so the UI renders it as a collapsible box
          const unknownId = `unknown-${uuidv4().slice(0, 8)}`;
          writer.write({
            type: 'tool-input-start',
            toolCallId: unknownId,
            toolName: '__unknown_event__',
          });
          writer.write({
            type: 'tool-input-available',
            toolCallId: unknownId,
            toolName: '__unknown_event__',
            input: chunk.raw,
          });
          writer.write({
            type: 'tool-output-available',
            toolCallId: unknownId,
            output: JSON.stringify(chunk.raw, null, 2),
          });
        }
      }

      // Close final text block if still open
      if (textStarted) {
        writer.write({ type: 'text-end', id: textId });
      }

      // Signal end of assistant message
      writer.write({ type: 'finish' });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * GET handler for /code/workspace-diff/[workspaceId] — diff stats with session auth.
 */
export async function getWorkspaceDiff(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { workspaceId } = await params;
  if (!workspaceId) {
    return Response.json({ success: false }, { status: 400 });
  }

  const { getWorkspaceDiffStats } = await import('../code/actions.js');
  const result = await getWorkspaceDiffStats(workspaceId, session.user);
  return Response.json(result);
}

/**
 * GET handler for /code/workspace-diff/[workspaceId]/full — full unified diff with session auth.
 */
export async function getWorkspaceDiffFull(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { workspaceId } = await params;
  if (!workspaceId) {
    return Response.json({ success: false }, { status: 400 });
  }

  const { getWorkspaceDiffFull: getDiffFull } = await import('../code/actions.js');
  const result = await getDiffFull(workspaceId, session.user);
  return Response.json(result);
}

/**
 * GET handler for /code/default-repo — returns the default repo with session auth.
 */
export async function getDefaultRepoHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  return Response.json({ repo: (owner && repo) ? `${owner}/${repo}` : null });
}

/**
 * GET handler for /chats/counts — notification + PR counts with session auth.
 */
export async function getSidebarCounts(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { getUnreadCount } = await import('../db/notifications.js');
  const notifications = getUnreadCount();
  let pullRequests = 0;
  try {
    const { getOpenPullRequests } = await import('../tools/github.js');
    pullRequests = (await getOpenPullRequests()).length;
  } catch {}
  return Response.json({ notifications, pullRequests });
}

/**
 * GET handler for /admin/app-version — version info with session auth.
 */
export async function getAppVersionHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { getInstalledVersion } = await import('../cron.js');
  const { getAvailableVersion, getReleaseNotes } = await import('../db/update-check.js');
  const version = getInstalledVersion();
  const available = getAvailableVersion();
  const isNewer = available && available !== version;
  return Response.json({
    version,
    updateAvailable: isNewer ? available : null,
    changelog: isNewer ? getReleaseNotes() : null,
  });
}

/**
 * POST handler for /admin/app-version — trigger immediate version check.
 */
export async function checkForUpdatesHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { runVersionCheck, getInstalledVersion } = await import('../cron.js');
  const { getAvailableVersion, getReleaseNotes } = await import('../db/update-check.js');
  await runVersionCheck();
  const version = getInstalledVersion();
  const available = getAvailableVersion();
  const isNewer = available && available !== version;
  return Response.json({
    version,
    updateAvailable: isNewer ? available : null,
    changelog: isNewer ? getReleaseNotes() : null,
  });
}

/**
 * GET handler for /chats — chat list with session auth.
 */
export async function getChatsHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit')) || undefined;
  const { or, eq, desc } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  let query = db
    .select({
      id: chats.id,
      userId: chats.userId,
      title: chats.title,
      starred: chats.starred,
      chatMode: chats.chatMode,
      codeWorkspaceId: chats.codeWorkspaceId,
      containerName: codeWorkspaces.containerName,
      hasChanges: codeWorkspaces.hasChanges,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
    })
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(or(eq(chats.userId, session.user.id), eq(chats.userId, 'telegram')))
    .orderBy(desc(chats.updatedAt));
  if (limit) query = query.limit(limit);
  return Response.json(query.all());
}

/**
 * POST handler for /code/workspace-branch — update workspace branch with session auth.
 */
export async function updateWorkspaceBranchHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { workspaceId, branch } = await request.json();
  const { getCodeWorkspaceById, updateBranch } = await import('../db/code-workspaces.js');
  const ws = getCodeWorkspaceById(workspaceId);
  if (!ws || ws.userId !== session.user.id) {
    return Response.json({ success: false }, { status: 403 });
  }
  updateBranch(workspaceId, branch);
  return Response.json({ success: true });
}

/**
 * GET handler for /chat/[chatId]/messages — chat messages with session auth.
 */
export async function getChatMessagesHandler(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { chatId } = await params;
  if (!chatId) return Response.json([], { status: 400 });
  const { getChatById, getMessagesByChatId } = await import('../db/chats.js');
  const chat = getChatById(chatId);
  if (!chat || (chat.userId !== session.user.id && chat.userId !== 'telegram')) {
    return Response.json([]);
  }
  return Response.json(getMessagesByChatId(chatId));
}

/**
 * GET handler for /chat/[chatId]/data — chat + workspace data with session auth.
 */
export async function getChatDataHandler(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { chatId } = await params;
  if (!chatId) return Response.json(null, { status: 400 });
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  const row = db
    .select()
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(eq(chats.id, chatId))
    .get();
  if (!row) return Response.json(null);
  const chat = row.chats;
  if (chat.userId !== session.user.id && chat.userId !== 'telegram') return Response.json(null);
  const ws = row.code_workspaces;
  return Response.json({ ...chat, workspace: ws?.id ? ws : null });
}

/**
 * GET handler for /code/[workspaceId]/chat-data — chat data by workspace with session auth.
 */
export async function getChatDataByWorkspaceHandler(request, { params }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const resolvedParams = await params;
  const workspaceId = resolvedParams.workspaceId || resolvedParams.codeWorkspaceId;
  if (!workspaceId) return Response.json(null, { status: 400 });
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  const row = db
    .select()
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(eq(chats.codeWorkspaceId, workspaceId))
    .get();
  if (!row) return Response.json(null);
  const chat = row.chats;
  if (chat.userId !== session.user.id && chat.userId !== 'telegram') return Response.json(null);
  const ws = row.code_workspaces;
  return Response.json({ chatId: chat.id, ...chat, workspace: ws?.id ? ws : null });
}

/**
 * GET handler for /code/repositories — list repositories with session auth.
 */
export async function getRepositoriesHandler() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { listRepositories } = await import('../tools/github.js');
    const repos = await listRepositories();
    return Response.json(repos);
  } catch {
    return Response.json([]);
  }
}

/**
 * POST handler for /code/repositories/create — create a new GitHub repository.
 */
export async function createRepositoryHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { name } = await request.json();
    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'Repository name is required' }, { status: 400 });
    }
    const { createRepository } = await import('../tools/github.js');
    const repo = await createRepository(name.trim());
    return Response.json(repo);
  } catch (err) {
    const message = err.message || 'Failed to create repository';
    return Response.json({ error: message }, { status: 422 });
  }
}

/**
 * GET handler for /code/branches?repo=owner/name — list branches with session auth.
 */
export async function getBranchesHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const repoFullName = url.searchParams.get('repo');
  if (!repoFullName) return Response.json([]);
  try {
    const { listBranches } = await import('../tools/github.js');
    const branches = await listBranches(repoFullName);
    return Response.json(branches);
  } catch {
    return Response.json([]);
  }
}

/**
 * GET handler for /chat/voice-token — AssemblyAI temporary token with session auth.
 */
export async function getVoiceTokenHandler(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { getConfig } = await import('../config.js');
  const apiKey = getConfig('ASSEMBLYAI_API_KEY');
  if (!apiKey) {
    return Response.json({ error: 'Voice transcription not configured' });
  }
  const res = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=60',
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) {
    return Response.json({ error: 'Failed to get voice token' });
  }
  const data = await res.json();
  return Response.json({ token: data.token });
}

/**
 * GET handler for /chat/scopes — list available agent scopes (subdirectories in agents/).
 * Returns an array of { name, path } objects.
 */
export async function getScopesHandler() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');
    const { PROJECT_ROOT } = await import('../paths.js');
    const agentsDir = join(PROJECT_ROOT, 'agents');

    try {
      const entries = readdirSync(agentsDir, { withFileTypes: true });
      const scopes = entries
        .filter(e => e.isDirectory() || e.isSymbolicLink())
        .filter(e => {
          // Verify symlinks resolve to directories
          if (e.isSymbolicLink()) {
            try { return statSync(join(agentsDir, e.name)).isDirectory(); } catch { return false; }
          }
          return true;
        })
        .map(e => ({ name: e.name, path: `agents/${e.name}` }));
      return Response.json(scopes);
    } catch (err) {
      if (err.code === 'ENOENT') return Response.json([]);
      throw err;
    }
  } catch {
    return Response.json([]);
  }
}

export async function finalizeChat(request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { chatId, message } = await request.json();
  const { autoTitle } = await import('../ai/index.js');
  const title = await autoTitle(chatId, message);

  // Look up linked workspace (if code chat)
  let codeWorkspaceId = null;
  let featureBranch = null;
  try {
    const { getChatById } = await import('../db/chats.js');
    const chat = getChatById(chatId);
    if (chat?.codeWorkspaceId) {
      codeWorkspaceId = chat.codeWorkspaceId;
      const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
      const ws = getCodeWorkspaceById(codeWorkspaceId);
      if (ws) featureBranch = ws.featureBranch;
    }
  } catch (err) {
    console.error('Failed to look up workspace:', err);
  }

  return Response.json({ title, codeWorkspaceId, featureBranch });
}
