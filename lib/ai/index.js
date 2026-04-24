import { randomUUID } from 'crypto';
import { z } from 'zod';
import path from 'path';
import { existsSync } from 'fs';
import { createModel } from './model.js';
import { PROJECT_ROOT } from '../paths.js';
import { render_md } from '../utils/render-md.js';
import { buildCodingAgentSystemPrompt } from './system-prompt.js';
import { getChatById, createChat, updateChatTitle, linkChatToWorkspace, saveMessage } from '../db/chats.js';
import { getConfig } from '../config.js';
import { getSdkAdapter } from './sdk-adapters/index.js';
import { ensureWorkspaceRepo } from './workspace-setup.js';
import { resolveAgentScope } from './scope.js';
import { readSessionId, writeSessionId } from './session-manager.js';
import { workspaceDir as getWorkspaceDir } from '../tools/docker.js';

/**
 * Ensure a chat exists in the DB and save a message.
 * Centralized so every channel gets persistence automatically.
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
 * Collect streamed text for channels that don't stream (e.g. Telegram one-shot).
 * Delegates to chatStream — single source of truth.
 */
async function chat(threadId, message, attachments = [], options = {}) {
  let fullText = '';
  for await (const chunk of chatStream(threadId, message, attachments, options)) {
    if (chunk.type === 'text') fullText += chunk.text;
  }
  return fullText;
}

/**
 * Process a chat message with streaming.
 * Saves user and assistant messages to the DB automatically.
 *
 * Two paths share identical chunk shape and persistence patterns:
 *   - SDK path: in-process @anthropic-ai/claude-agent-sdk (claude-code only)
 *   - Direct path: headless Docker container running the configured coding agent
 */
async function* chatStream(threadId, message, attachments = [], options = {}) {
  const isCodeMode = !!options.codeMode;
  const existingChat = getChatById(threadId);
  let workspaceId = options.workspaceId;
  const repo = options.repo;
  const branch = options.branch;
  const codeModeType = options.codeModeType || 'plan';

  // Resolve workspace — for existing chats, read scope from DB (client may not resend it after refresh)
  let resolvedScope = options.scope || null;

  if (!existingChat) {
    if (!workspaceId) {
      const { createCodeWorkspace, updateFeatureBranch } = await import('../db/code-workspaces.js');
      const workspace = createCodeWorkspace(options.userId || 'unknown', {
        repo,
        branch,
        scope: resolvedScope,
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
    if (!resolvedScope && workspaceId) {
      const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
      const ws = getCodeWorkspaceById(workspaceId);
      if (ws?.scope) resolvedScope = ws.scope;
    }
  }

  // Save user message (skip on regeneration — message already exists)
  if (!options.skipUserPersist) {
    persistMessage(threadId, 'user', message || '[attachment]', options);
  }

  const wsBaseDir = getWorkspaceDir(workspaceId);
  const repoDir = path.join(wsBaseDir, 'workspace');
  const codingAgent = getConfig('CODING_AGENT') || 'claude-code';
  const sdkAdapter = getSdkAdapter(codingAgent);

  // Resolve agent-mode-specific vs code-mode-specific values used by both paths
  let effectiveRepo, effectiveBranch, systemPrompt, injectSecrets;
  if (isCodeMode) {
    effectiveRepo = repo;
    effectiveBranch = branch;
    systemPrompt = buildCodingAgentSystemPrompt('code');
    injectSecrets = false;
  } else {
    const ghOwner = getConfig('GH_OWNER');
    const ghRepo = getConfig('GH_REPO');
    if (!ghOwner || !ghRepo) {
      const msg = 'GH_OWNER or GH_REPO not configured';
      yield { type: 'error', message: msg };
      persistMessage(threadId, 'assistant', JSON.stringify({ type: 'error', message: msg }), options);
      return;
    }
    effectiveRepo = `${ghOwner}/${ghRepo}`;
    effectiveBranch = 'main';
    const { skillsDir } = resolveAgentScope(repoDir, resolvedScope || null);
    systemPrompt = buildCodingAgentSystemPrompt('agent', skillsDir, resolvedScope || null);
    injectSecrets = true;
  }

  const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
  const workspace = getCodeWorkspaceById(workspaceId);
  const featureBranch = workspace?.featureBranch;

  // Workspace setup — visible to user as a `workspace` tool-call the first time
  const needsSetup = !existsSync(path.join(repoDir, '.git'));
  const setupToolCallId = `setup-${workspaceId.slice(0, 8)}`;
  const setupArgs = { repo: effectiveRepo, branch: effectiveBranch, featureBranch };

  if (needsSetup) {
    yield { type: 'tool-call', toolCallId: setupToolCallId, toolName: 'workspace', args: setupArgs };
  }

  try {
    const setupOutput = await ensureWorkspaceRepo({ workspaceDir: repoDir, repo: effectiveRepo, branch: effectiveBranch, featureBranch });
    if (needsSetup) {
      const result = setupOutput || `Workspace ready on ${featureBranch || effectiveBranch}`;
      yield { type: 'tool-result', toolCallId: setupToolCallId, result };
      persistMessage(threadId, 'assistant', JSON.stringify({
        type: 'tool-invocation',
        toolCallId: setupToolCallId,
        toolName: 'workspace',
        state: 'output-available',
        input: setupArgs,
        output: result,
      }), options);
    }
  } catch (err) {
    const msg = err.message || 'Workspace setup failed';
    if (needsSetup) {
      yield { type: 'tool-result', toolCallId: setupToolCallId, result: `Setup failed: ${msg}` };
    }
    yield { type: 'error', message: msg };
    persistMessage(threadId, 'assistant', JSON.stringify({ type: 'error', message: msg }), options);
    return;
  }

  // Fork on SDK availability
  if (sdkAdapter) {
    yield* streamViaSdk({ threadId, message, attachments, options, wsBaseDir, repoDir, resolvedScope, isCodeMode, codeModeType, systemPrompt, workspaceId, sdkAdapter });
  } else {
    yield* streamViaContainer({ threadId, message, options, codingAgent, workspaceId, featureBranch, effectiveRepo, effectiveBranch, systemPrompt, injectSecrets, codeModeType, resolvedScope });
  }

  // Auto-generate title for new chats (runs once after either path completes)
  if (options.userId && message) {
    autoTitle(threadId, message).catch(() => {});
  }
}

/**
 * SDK path — in-process @anthropic-ai/claude-agent-sdk.
 * Used only when a registered SDK adapter exists for the active coding agent.
 */
async function* streamViaSdk({ threadId, message, attachments, options, wsBaseDir, repoDir, resolvedScope, isCodeMode, codeModeType, systemPrompt, workspaceId, sdkAdapter }) {
  const chatMode = isCodeMode ? 'code' : 'agent';
  const { workingDir } = resolveAgentScope(repoDir, resolvedScope);
  const sessionId = readSessionId(wsBaseDir);

  let pendingText = '';
  const pendingToolCalls = new Map();

  try {
    for await (const chunk of sdkAdapter({
      prompt: message,
      workspaceDir: workingDir,
      systemPrompt,
      sessionId,
      permissionMode: codeModeType,
      attachments,
      workspaceId,
      chatMode,
    })) {
      if (chunk.type === 'meta' && chunk.sessionId) {
        writeSessionId(wsBaseDir, chunk.sessionId);
      }

      if (chunk.type === 'text') {
        pendingText += chunk.text;
      } else if (chunk.type === 'tool-call') {
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
    const msg = err.message || 'SDK stream failed';
    console.error('[streamViaSdk] error:', err);
    yield { type: 'error', message: msg };
    persistMessage(threadId, 'assistant', JSON.stringify({ type: 'error', message: msg }), options);
  } finally {
    if (pendingText) {
      persistMessage(threadId, 'assistant', pendingText, options);
    }
  }
}

/**
 * Direct headless path — spawn the coding agent in an ephemeral Docker container,
 * stream its output via parseHeadlessStream, and yield normalized chunks.
 *
 * Replaces the former LangGraph React agent + `coding_agent` tool — there is no
 * LLM layer between the user's message and the container. Multi-turn memory
 * lives in the agent's own session files inside the volume-mounted workspace
 * (see docker/coding-agent/CLAUDE.md § Session Tracking).
 */
async function* streamViaContainer({ threadId, message, options, codingAgent, workspaceId, featureBranch, effectiveRepo, effectiveBranch, systemPrompt, injectSecrets, codeModeType, resolvedScope }) {
  const containerName = `${codingAgent}-headless-${randomUUID().slice(0, 8)}`;
  const mode = codeModeType === 'code' ? 'dangerous' : 'plan';
  const { runHeadlessContainer, tailContainerLogs, waitForContainer, removeContainer } = await import('../tools/docker.js');
  const { parseHeadlessStream } = await import('./headless-stream.js');

  // Synthetic coding_agent wrapper — bracketing tool-call/tool-result pair so the
  // user can see that the direct-container path ran (the SDK path has no wrapper).
  // Inner container chunks stream as top-level parts alongside it; AI SDK parts
  // are flat, so this is a visual anchor, not a container for nested content.
  const wrapperId = `coding-agent-${randomUUID().slice(0, 8)}`;
  const providerKeys = {
    'claude-code': 'CODING_AGENT_CLAUDE_CODE_BACKEND',
    'pi-coding-agent': 'CODING_AGENT_PI_PROVIDER',
    'gemini-cli': 'CODING_AGENT_GEMINI_CLI_PROVIDER',
    'codex-cli': 'CODING_AGENT_CODEX_CLI_PROVIDER',
    'opencode': 'CODING_AGENT_OPENCODE_PROVIDER',
    'kimi-cli': 'CODING_AGENT_KIMI_CLI_PROVIDER',
  };
  const backendApi = getConfig(providerKeys[codingAgent]) || 'anthropic';
  const wrapperArgs = { prompt: message, codingAgent, backendApi };

  yield { type: 'tool-call', toolCallId: wrapperId, toolName: 'coding_agent', args: wrapperArgs };

  let pendingText = '';
  const pendingToolCalls = new Map();
  let started = false;
  let wrapperClosed = false;

  const closeWrapper = (result) => {
    if (wrapperClosed) return null;
    wrapperClosed = true;
    persistMessage(threadId, 'assistant', JSON.stringify({
      type: 'tool-invocation',
      toolCallId: wrapperId,
      toolName: 'coding_agent',
      state: 'output-available',
      input: wrapperArgs,
      output: result,
    }), options);
    return { type: 'tool-result', toolCallId: wrapperId, result };
  };

  try {
    await runHeadlessContainer({
      containerName,
      repo: effectiveRepo,
      branch: effectiveBranch,
      featureBranch,
      workspaceId,
      taskPrompt: message,
      mode,
      systemPrompt,
      injectSecrets,
      scope: resolvedScope || undefined,
    });
    started = true;

    const logStream = await tailContainerLogs(containerName);

    for await (const chunk of parseHeadlessStream(logStream, codingAgent)) {
      if (chunk.type === 'text') {
        pendingText += chunk.text;
      } else if (chunk.type === 'tool-call') {
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

    const exitCode = await waitForContainer(containerName);
    await removeContainer(containerName);

    const closeResult = exitCode === 0 ? 'Completed' : `Exited with code ${exitCode}`;
    const closeChunk = closeWrapper(closeResult);
    if (closeChunk) yield closeChunk;

    if (exitCode !== 0) {
      const msg = `Coding agent exited with code ${exitCode}`;
      yield { type: 'error', message: msg };
      persistMessage(threadId, 'assistant', JSON.stringify({ type: 'error', message: msg }), options);
    }
  } catch (err) {
    const msg = err.message || 'Coding agent failed';
    console.error('[streamViaContainer] error:', err);
    const closeChunk = closeWrapper(`Error: ${msg}`);
    if (closeChunk) yield closeChunk;
    yield { type: 'error', message: msg };
    persistMessage(threadId, 'assistant', JSON.stringify({ type: 'error', message: msg }), options);
    if (started) {
      try { await removeContainer(containerName); } catch {}
    }
  } finally {
    if (pendingText) {
      persistMessage(threadId, 'assistant', pendingText, options);
    }
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
