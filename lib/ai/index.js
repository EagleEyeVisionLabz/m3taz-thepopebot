import { HumanMessage } from '@langchain/core/messages';
import { createChannel, mergeAsyncIterables } from './async-channel.js';
import { z } from 'zod';
import { getAgentChat, getCodeChat } from './agent.js';
import { createModel } from './model.js';
import path from 'path';
import { existsSync } from 'fs';
import { PROJECT_ROOT } from '../paths.js';
import { render_md } from '../utils/render-md.js';
import { buildCodingAgentSystemPrompt } from './system-prompt.js';
import { getChatById, createChat, saveMessage, updateChatTitle, linkChatToWorkspace } from '../db/chats.js';
import { getConfig } from '../config.js';
import { getSdkAdapter } from './sdk-adapters/index.js';
import { ensureWorkspaceRepo, ensureSkills } from './workspace-setup.js';
import { readSessionId, writeSessionId } from './session-manager.js';
import { workspaceDir as getWorkspaceDir } from '../tools/docker.js';

/**
 * Ensure a chat exists in the DB and save a message.
 * Centralized so every channel gets persistence automatically.
 *
 * @param {string} threadId - Chat/thread ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} text - Message text
 * @param {object} [options] - { userId, chatTitle }
 */
function persistMessage(threadId, role, text, options = {}) {
  try {
    if (!getChatById(threadId)) {
      createChat(options.userId || 'unknown', options.chatTitle || 'New Chat', threadId);
    }
    saveMessage(threadId, role, text);
  } catch (err) {
    console.error(`[persistMessage] Failed to save ${role} message to chat ${threadId} (${text?.length ?? 0} chars):`, err);
  }
}

/**
 * Process a chat message through the LangGraph agent.
 * Saves user and assistant messages to the DB automatically.
 *
 * @param {string} threadId - Conversation thread ID (from channel adapter)
 * @param {string} message - User's message text
 * @param {Array} [attachments=[]] - Normalized attachments from adapter
 * @param {object} [options] - { userId, chatTitle } for DB persistence
 * @returns {Promise<string>} AI response text
 */
async function chat(threadId, message, attachments = [], options = {}) {
  // SDK path: delegate to chatStream and collect text
  const sdkAdapter = getSdkAdapter(getConfig('CODING_AGENT'));

  if (sdkAdapter) {
    let fullText = '';
    for await (const chunk of chatStream(threadId, message, attachments, options)) {
      if (chunk.type === 'text') fullText += chunk.text;
    }
    return fullText;
  }

  // Legacy LangGraph path
  const agent = await getAgentChat();

  // Save user message to DB
  persistMessage(threadId, 'user', message || '[attachment]', options);

  // Build content blocks: text + any image attachments as base64 vision
  const content = [];

  if (message) {
    content.push({ type: 'text', text: message });
  }

  for (const att of attachments) {
    if (att.category === 'image') {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${att.mimeType};base64,${att.data.toString('base64')}`,
        },
      });
    }
    // Documents: future handling
  }

  // If only text and no attachments, simplify to a string
  const messageContent = content.length === 1 && content[0].type === 'text'
    ? content[0].text
    : content;

  const result = await agent.invoke(
    { messages: [new HumanMessage({ content: messageContent })] },
    { configurable: { thread_id: threadId } }
  );

  const lastMessage = result.messages[result.messages.length - 1];

  // LangChain message content can be a string or an array of content blocks
  let response;
  if (typeof lastMessage.content === 'string') {
    response = lastMessage.content;
  } else {
    response = lastMessage.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  // Save assistant response to DB
  persistMessage(threadId, 'assistant', response, options);

  // Auto-generate title for new chats
  if (options.userId && message) {
    autoTitle(threadId, message).catch(() => {});
  }

  return response;
}

/**
 * Process a chat message with streaming (for channels that support it).
 * Saves user and assistant messages to the DB automatically.
 *
 * @param {string} threadId - Conversation thread ID
 * @param {string} message - User's message text
 * @param {Array} [attachments=[]] - Image/PDF attachments: { category, mimeType, dataUrl }
 * @param {object} [options] - { userId, chatTitle, skipUserPersist } for DB persistence
 * @returns {AsyncIterableIterator<string>} Stream of text chunks
 */
async function* chatStream(threadId, message, attachments = [], options = {}) {
  // Resolve agent and workspace context
  const isCodeMode = !!options.codeMode;
  const existingChat = getChatById(threadId);
  let workspaceId = options.workspaceId;
  const repo = options.repo;
  const branch = options.branch;
  const codeModeType = options.codeModeType || 'plan';

  if (!existingChat) {
    // Create workspace if not already provided
    if (!workspaceId) {
      const { createCodeWorkspace, updateFeatureBranch } = await import('../db/code-workspaces.js');
      const workspace = createCodeWorkspace(options.userId || 'unknown', {
        repo: repo,
        branch: branch,
      });
      workspaceId = workspace.id;
      const { generateRandomName } = await import('../utils/random-name.js');
      const shortId = workspaceId.replace(/-/g, '').slice(0, 8);
      const featureBranch = `thepopebot/${generateRandomName()}-${shortId}`;
      updateFeatureBranch(workspaceId, featureBranch);
    }
    createChat(options.userId || 'unknown', 'New Chat', threadId, { chatMode: isCodeMode ? 'code' : 'agent' });
    linkChatToWorkspace(threadId, workspaceId);
  } else {
    workspaceId = workspaceId || existingChat.codeWorkspaceId;
  }

  // ── SDK path: direct in-process SDK call (no LangGraph, no Docker) ──
  const sdkAdapter = getSdkAdapter(getConfig('CODING_AGENT'));
  const useSDK = !!sdkAdapter;

  // Save user message to DB (skip on regeneration — message already exists)
  if (!options.skipUserPersist) {
    persistMessage(threadId, 'user', message || '[attachment]', options);
  }

  if (useSDK) {
    // 1. Workspace setup (idempotent — skips if .git exists)
    const wsBaseDir = getWorkspaceDir(workspaceId);
    const repoDir = path.join(wsBaseDir, 'workspace');

    const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
    const workspace = getCodeWorkspaceById(workspaceId);
    const featureBranch = workspace?.featureBranch;

    const needsSetup = !existsSync(path.join(repoDir, '.git'));
    const setupToolCallId = `setup-${workspaceId.slice(0, 8)}`;
    const setupArgs = { repo, branch, featureBranch };

    if (needsSetup) {
      yield { type: 'tool-call', toolCallId: setupToolCallId, toolName: 'set_up_workspace', args: setupArgs };
    }

    try {
      await ensureWorkspaceRepo({ workspaceDir: repoDir, repo, branch, featureBranch });
      ensureSkills(repoDir, isCodeMode ? 'code' : 'agent');
      if (needsSetup) {
        const result = `Workspace ready on ${featureBranch || branch}`;
        yield { type: 'tool-result', toolCallId: setupToolCallId, result };
        persistMessage(threadId, 'assistant', JSON.stringify({
          type: 'tool-invocation',
          toolCallId: setupToolCallId,
          toolName: 'set_up_workspace',
          state: 'output-available',
          input: setupArgs,
          output: result,
        }), options);
      }
    } catch (err) {
      if (needsSetup) {
        yield { type: 'tool-result', toolCallId: setupToolCallId, result: `Setup failed: ${err.message}` };
      }
      throw err;
    }

    // 2. Session continuity
    const sessionId = readSessionId(wsBaseDir);

    // 3. System prompt
    const systemPrompt = buildCodingAgentSystemPrompt(isCodeMode ? 'code' : 'agent');

    // 4. Stream from SDK adapter
    let pendingText = '';
    const pendingToolCalls = new Map();

    try {
      for await (const chunk of sdkAdapter({
        prompt: message,
        workspaceDir: repoDir,
        systemPrompt,
        sessionId,
        permissionMode: codeModeType,
        attachments,
        workspaceId,
        chatMode: isCodeMode ? 'code' : 'agent',
      })) {
        // Write session ID on first meta chunk
        if (chunk.type === 'meta' && chunk.sessionId) {
          writeSessionId(wsBaseDir, chunk.sessionId);
        }

        // DB persistence
        if (chunk.type === 'text') {
          pendingText += chunk.text;
        } else if (chunk.type === 'tool-call') {
          // Flush accumulated text before tool call
          if (pendingText) {
            persistMessage(threadId, 'assistant', pendingText, options);
            pendingText = '';
          }
          pendingToolCalls.set(chunk.toolCallId, { toolName: chunk.toolName, args: chunk.args });
        } else if (chunk.type === 'tool-result') {
          const tc = pendingToolCalls.get(chunk.toolCallId);
          if (tc) {
            persistMessage(threadId, 'assistant', JSON.stringify({
              type: 'tool-invocation',
              toolCallId: chunk.toolCallId,
              toolName: tc.toolName,
              state: 'output-available',
              input: tc.args,
              output: chunk.result,
            }), options);
            pendingToolCalls.delete(chunk.toolCallId);
          }
        }

        yield chunk;
      }
    } catch (err) {
      console.error('[chatStream] error:', err);
      throw err;
    } finally {
      // Flush remaining text
      if (pendingText) {
        persistMessage(threadId, 'assistant', pendingText, options);
      }
    }

    // Auto-generate title for new chats
    if (options.userId && message) {
      autoTitle(threadId, message).catch(() => {});
    }

    return;
  }

  // ── Legacy path: LangGraph + Docker (non-claude-code agents + job mode) ──

  const agent = isCodeMode
    ? await getCodeChat()
    : await getAgentChat();

  // Build content blocks: text + any image/PDF attachments as vision
  const content = [];

  if (message) {
    content.push({ type: 'text', text: message });
  }

  for (const att of attachments) {
    if (att.category === 'image') {
      // Support both dataUrl (web) and Buffer (Telegram) formats
      const url = att.dataUrl
        ? att.dataUrl
        : `data:${att.mimeType};base64,${att.data.toString('base64')}`;
      content.push({
        type: 'image_url',
        image_url: { url },
      });
    }
  }

  // If only text and no attachments, simplify to a string
  let messageContent = content.length === 1 && content[0].type === 'text'
    ? content[0].text
    : content;

  // Append chat mode for agent chats so the LLM sees the user's selected mode
  if (!isCodeMode) {
    if (typeof messageContent === 'string') {
      messageContent += `\n\n[chat mode: ${codeModeType}]`;
    } else if (Array.isArray(messageContent)) {
      const textBlock = messageContent.find(b => b.type === 'text');
      if (textBlock) textBlock.text += `\n\n[chat mode: ${codeModeType}]`;
    }
  }

  // Side channel: bridges the tool's live container output to this generator
  const sideChannel = createChannel();
  const streamCallback = (chunk) => {
    if (chunk === null) sideChannel.done();
    else sideChannel.push(chunk);
  };

  try {
    const stream = await agent.stream(
      { messages: [new HumanMessage({ content: messageContent })] },
      { configurable: { thread_id: threadId, workspaceId, repo, branch, codeModeType, streamCallback }, streamMode: 'messages' }
    );

    const toolCallNames = {};
    const pendingToolCalls = new Map();

    // Accumulate raw tool call arg fragments across streaming chunks.
    // Each AIMessageChunk only carries its own delta — the first chunk
    // (content_block_start) has id+index+name with args "", subsequent
    // chunks (input_json_delta) have only index with the partial JSON delta.
    const toolCallRawArgs = {};     // tool_call_id → accumulated args string
    const indexToToolCallId = {};   // chunk index → tool_call_id
    const toolCallArgsEmitted = new Set(); // tool_call_ids whose complete args have been yielded

    // Headless container streaming state
    const headlessPendingToolCalls = new Map();
    let pendingText = '';       // channel text, flushed to DB at tool boundaries
    let llmTextAccum = '';      // langgraph text (direct response or LLM follow-up after container)

    // Tag helper so mergeAsyncIterables can tell the two sources apart.
    // The LangGraph wrapper also closes sideChannel when the agent stream
    // finishes — this prevents a deadlock when no tool calls streamCallback.
    async function* tagged(iter, source) {
      for await (const item of iter) yield { _src: source, item };
      if (source === 'lg') sideChannel.done();
    }

    try {
      for await (const { _src, item } of mergeAsyncIterables(
        tagged(stream, 'lg'),
        tagged(sideChannel, 'ch')
      )) {
        if (_src === 'lg') {
          // ── LangGraph agent stream ────────────────────────────────────────
          const msg = Array.isArray(item) ? item[0] : item;
          const msgType = msg._getType?.();

          if (msgType === 'ai') {
            // Tool calls — AIMessage.tool_calls is an array of { id, name, args }
            if (msg.tool_calls?.length > 0) {
              for (const tc of msg.tool_calls) {
                toolCallNames[tc.id] = tc.name;
                pendingToolCalls.set(tc.id, { toolName: tc.name, args: tc.args });
                yield {
                  type: 'tool-call',
                  toolCallId: tc.id,
                  toolName: tc.name,
                  args: tc.args,
                };
              }
            }

            // Accumulate raw tool call arg strings from streaming chunks
            if (msg.tool_call_chunks?.length > 0) {
              for (const c of msg.tool_call_chunks) {
                if (c.id) {
                  indexToToolCallId[c.index] = c.id;
                  toolCallRawArgs[c.id] = (toolCallRawArgs[c.id] || '') + (c.args || '');
                } else if (c.index != null && indexToToolCallId[c.index]) {
                  const id = indexToToolCallId[c.index];
                  toolCallRawArgs[id] = (toolCallRawArgs[id] || '') + (c.args || '');
                }
              }
              // Re-yield tool-call with complete args once the JSON is fully streamed
              for (const c of msg.tool_call_chunks) {
                const id = c.id || indexToToolCallId[c.index];
                if (id && toolCallRawArgs[id] && !toolCallArgsEmitted.has(id)) {
                  try {
                    const parsed = JSON.parse(toolCallRawArgs[id]);
                    toolCallArgsEmitted.add(id);
                    const tc = pendingToolCalls.get(id);
                    if (tc) {
                      tc.args = parsed;
                      yield { type: 'tool-call', toolCallId: id, toolName: tc.toolName, args: parsed };
                    }
                  } catch {} // args not complete yet, keep accumulating
                }
              }
            }

            // Text content (wrapped in structured object)
            let text = '';
            if (typeof msg.content === 'string') {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              text = msg.content
                .filter((b) => b.type === 'text' && b.text)
                .map((b) => b.text)
                .join('');
            }

            if (text) {
              llmTextAccum += text;
              yield { type: 'text', text };
            }
          } else if (msgType === 'tool') {
            // Parse complete args from accumulated raw fragments
            const tc = pendingToolCalls.get(msg.tool_call_id);
            const rawArgs = toolCallRawArgs[msg.tool_call_id];
            let completeArgs;
            try { completeArgs = rawArgs ? JSON.parse(rawArgs) : {}; } catch { completeArgs = {}; }

            // Tool result — ToolMessage has tool_call_id and content
            yield {
              type: 'tool-result',
              toolCallId: msg.tool_call_id,
              toolName: tc?.toolName,
              args: completeArgs,
              result: msg.content,
            };

            // Save complete tool invocation as JSON
            if (tc) {
              persistMessage(threadId, 'assistant', JSON.stringify({
                type: 'tool-invocation',
                toolCallId: msg.tool_call_id,
                toolName: tc.toolName,
                state: 'output-available',
                input: completeArgs,
                output: msg.content,
              }), options);
              pendingToolCalls.delete(msg.tool_call_id);
            }
          }
          // Skip other message types (human, system)

        } else {
          // ── Side channel: headless container chunks ───────────────────────
          const chunk = item;

          if (chunk.type === 'text') {
            pendingText += chunk.text;
            yield chunk;
          } else if (chunk.type === 'tool-call') {
            // Flush accumulated text before tool call
            if (pendingText) {
              persistMessage(threadId, 'assistant', pendingText, options);
              pendingText = '';
            }
            headlessPendingToolCalls.set(chunk.toolCallId, { toolName: chunk.toolName, args: chunk.args });
            yield chunk;
          } else if (chunk.type === 'tool-result') {
            // Enrich with args from matching tool-call (required by api.js tool-input-available update)
            const htc = headlessPendingToolCalls.get(chunk.toolCallId);
            const enriched = htc ? { ...chunk, args: htc.args, toolName: htc.toolName } : chunk;
            yield enriched;
            if (htc) {
              persistMessage(threadId, 'assistant', JSON.stringify({
                type: 'tool-invocation',
                toolCallId: chunk.toolCallId,
                toolName: htc.toolName,
                state: 'output-available',
                input: htc.args,
                output: chunk.result,
              }), options);
              headlessPendingToolCalls.delete(chunk.toolCallId);
            }
          } else {
            // unknown/meta events pass through unchanged
            yield chunk;
          }
        }
      }
    } finally {
      // Ensure no dangling promise when tool was never called
      sideChannel.done();
    }

    // Flush remaining channel text
    if (pendingText) {
      persistMessage(threadId, 'assistant', pendingText, options);
    }

    // Persist LLM text (direct response with no tool, or LLM follow-up after container)
    if (llmTextAccum) {
      persistMessage(threadId, 'assistant', llmTextAccum, options);
    }

  } catch (err) {
    console.error('[chatStream] error:', err);
    throw err;
  }
}

/**
 * Auto-generate a chat title from the first user message (fire-and-forget).
 * Uses structured output to avoid thinking-token leaks with extended-thinking models.
 */
async function autoTitle(threadId, firstMessage) {
  try {
    const chat = getChatById(threadId);
    if (!chat || chat.title !== 'New Chat') return;

    const model = await createModel({ maxTokens: 250 });
    const response = await model.withStructuredOutput(z.object({ title: z.string() })).invoke([
      ['system', 'Title this chat in 2-5 words. Name the subject matter only. Never start with "User". Never describe what the user is doing — just the topic. Always produce a title, even for vague messages — infer the likely topic.'],
      ['human', firstMessage],
    ]);
    if (response.title.trim()) {
      updateChatTitle(threadId, response.title.trim());

      return response.title.trim();
    }
  } catch (err) {
    console.error('[autoTitle] Failed to generate title:', err.message);
  }
  return null;
}

/**
 * One-shot summarization with a different system prompt and no memory.
 * Used for agent job completion summaries sent via GitHub webhook.
 *
 * @param {object} results - Agent job results from webhook payload
 * @returns {Promise<string>} Summary text
 */
async function summarizeAgentJob(results) {
  try {
    const model = await createModel({ maxTokens: 1024 });
    const summaryMdPath = path.join(PROJECT_ROOT, 'event-handler/SUMMARY.md');
    const systemPrompt = render_md(summaryMdPath);

    if (!systemPrompt) {
      console.error(`[summarizeAgentJob] Empty system prompt — event-handler/SUMMARY.md not found or empty at: ${summaryMdPath}`);
    }

    const userMessage = [
      results.job ? `## Task\n${results.job}` : '',
      results.commit_message ? `## Commit Message\n${results.commit_message}` : '',
      results.changed_files?.length ? `## Changed Files\n${results.changed_files.join('\n')}` : '',
      results.status ? `## Status\n${results.status}` : '',
      results.merge_result ? `## Merge Result\n${results.merge_result}` : '',
      results.pr_url ? `## PR URL\n${results.pr_url}` : '',
      results.run_url ? `## Run URL\n${results.run_url}` : '',
      results.log ? `## Agent Log\n${results.log}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    console.log(`[summarizeAgentJob] System prompt: ${systemPrompt.length} chars, user message: ${userMessage.length} chars`);

    const response = await model.invoke([
      ['system', systemPrompt],
      ['human', userMessage],
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : response.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n');

    console.log(`[summarizeAgentJob] Result: ${text.length} chars — ${text.slice(0, 200)}`);

    return text.trim() || 'Agent job finished.';
  } catch (err) {
    console.error('[summarizeAgentJob] Failed to summarize agent job:', err);
    return 'Agent job finished.';
  }
}

export { chat, chatStream, summarizeAgentJob, persistMessage, autoTitle };
