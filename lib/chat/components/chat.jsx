'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Messages } from './messages.js';
import { ChatInput } from './chat-input.js';
import { ChatHeader } from './chat-header.js';
import { Greeting } from './greeting.js';
import { RepoBranchPicker, WorkspaceBar } from './code-mode-toggle.js';
import { ScopePicker } from './scope-picker.js';
import { DiffViewer } from './diff-viewer.js';
import { cn } from '../utils.js';

const fetchRepositories = () =>
  fetch('/code/repositories')
    .then(r => r.json())
    .catch(() => []);

const fetchBranches = (repoFullName) =>
  fetch(`/code/branches?repo=${encodeURIComponent(repoFullName)}`)
    .then(r => r.json())
    .catch(() => []);

const fetchCreateRepository = (name) =>
  fetch('/code/repositories/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(r => {
    if (!r.ok) return r.json().then(d => { throw new Error(d.error || 'Failed to create repository'); });
    return r.json();
  });

export function Chat({ chatId, initialMessages = [], workspace = null, chatMode = null }) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const hasNavigated = useRef(false);
  const [codeMode, setCodeMode] = useState(chatMode === 'code');
  const [codeModeType, setCodeModeType] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`codeModeType:${chatId}`);
      if (stored === 'plan' || stored === 'code' || stored === 'job') return stored;
    }
    return 'code';
  });

  // Persist codeModeType to localStorage per chat
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`codeModeType:${chatId}`, codeModeType);
    }
  }, [chatId, codeModeType]);
  const [defaultRepo, setDefaultRepo] = useState(null);
  const [repo, setRepo] = useState(workspace?.repo || '');
  const [branch, setBranch] = useState(workspace?.branch || '');
  const [workspaceState, setWorkspaceState] = useState(workspace);
  const [diffStats, setDiffStats] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [availableAgents, setAvailableAgents] = useState(null);
  const [scope, setScope] = useState(null);
  const [availableScopes, setAvailableScopes] = useState(null);

  // Load available coding agents once on mount (for the right-click agent picker)
  useEffect(() => {
    import('../actions.js').then(({ getAvailableCodingAgents }) => {
      getAvailableCodingAgents().then(agents => setAvailableAgents(agents)).catch(() => {});
    }).catch(() => {});
  }, []);

  // Load available agent scopes for agent mode
  useEffect(() => {
    if (!codeMode) {
      fetch('/chat/scopes')
        .then(r => r.json())
        .then(scopes => setAvailableScopes(scopes))
        .catch(() => setAvailableScopes([]));
    }
  }, [codeMode]);

  // Fetch default repo for agent mode on mount
  // Uses fetch instead of server action to avoid Next.js page revalidation
  useEffect(() => {
    fetch('/code/default-repo')
      .then(res => res.json())
      .then(({ repo: r }) => {
        if (r) {
          setDefaultRepo(r);
          if (!workspace && !repo && !codeMode) {
            setRepo(r);
            setBranch('main');
          }
        }
      }).catch(() => {});
  }, []);

  // Auto-forward to interactive workspace — only on toggle, not on mount
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (workspaceState?.containerName && workspaceState?.id) {
      window.location.href = `/code/${workspaceState.id}`;
    }
  }, [workspaceState?.containerName]);

  const codeModeRef = useRef({ codeMode, codeModeType, repo, branch, workspaceId: workspaceState?.id, scope });
  codeModeRef.current = { codeMode, codeModeType, repo, branch, workspaceId: workspaceState?.id, scope };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/stream/chat',
        body: () => ({
          chatId,
          codeMode: codeModeRef.current.codeMode,
          codeModeType: codeModeRef.current.codeModeType,
          repo: codeModeRef.current.repo,
          branch: codeModeRef.current.branch,
          workspaceId: codeModeRef.current.workspaceId,
          scope: codeModeRef.current.scope || undefined,
        }),
      }),
    [chatId]
  );

  const {
    messages,
    status,
    stop,
    error,
    sendMessage,
    regenerate,
    setMessages,
  } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onError: (err) => console.error('Chat error:', err),
  });

  // Fetch diff stats on mount (existing workspace) and when AI finishes responding
  const prevStatus = useRef(status);
  useEffect(() => {
    if (!workspaceState?.id) return;
    const isMount = prevStatus.current === status;
    const isFinished = prevStatus.current !== 'ready' && status === 'ready';
    if (isMount || isFinished) {
      fetch(`/code/workspace-diff/${workspaceState.id}`)
        .then(r => r.json())
        .then(r => {
          if (r.success) {
            setDiffStats(r);
            if (r.currentBranch) {
              setWorkspaceState(prev => prev && r.currentBranch !== prev.featureBranch ? { ...prev, featureBranch: r.currentBranch } : prev);
            }
          }
        })
        .catch(() => {});
    }
    prevStatus.current = status;
  }, [status, workspaceState?.id]);

  // After first message sent, update URL and notify sidebar
  useEffect(() => {
    if (!hasNavigated.current && messages.length >= 1 && status !== 'ready' && window.location.pathname !== `/chat/${chatId}`) {
      hasNavigated.current = true;
      window.history.replaceState({}, '', `/chat/${chatId}`);
    }
  }, [messages.length, status, chatId]);

  const handleSend = async () => {
    if (!input.trim() && files.length === 0) return;
    const text = input;
    const isFirstMessage = messages.length === 0;
    const currentFiles = files;
    setInput('');
    setFiles([]);

    const fileParts = currentFiles.map((f) => ({
      type: 'file',
      mediaType: f.file.type || 'text/plain',
      url: f.previewUrl,
      filename: f.file.name,
    }));
    await sendMessage({ text: text || undefined, files: fileParts });

    if (isFirstMessage && text) {
      fetch('/chat/finalize-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message: text }),
      })
        .then(res => res.json())
        .then(({ title, codeWorkspaceId, featureBranch }) => {
          if (title) {
            window.dispatchEvent(new CustomEvent('chatTitleUpdated', { detail: { chatId, title, codeWorkspaceId, chatMode: codeMode ? 'code' : 'agent' } }));
          }
          if (codeWorkspaceId) {
            setWorkspaceState({ id: codeWorkspaceId, featureBranch, repo, branch, containerName: null });
          }
        })
        .catch(err => console.error('Failed to finalize chat:', err));
    }
  };

  const handleRetry = useCallback((message) => {
    if (message.role === 'assistant') {
      regenerate({ messageId: message.id });
    } else {
      // User message — find the next assistant message and regenerate it
      const idx = messages.findIndex((m) => m.id === message.id);
      const nextAssistant = messages.slice(idx + 1).find((m) => m.role === 'assistant');
      if (nextAssistant) {
        regenerate({ messageId: nextAssistant.id });
      } else {
        // No assistant response yet — extract text and resend
        const text =
          message.parts
            ?.filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n') ||
          message.content ||
          '';
        if (text.trim()) {
          sendMessage({ text });
        }
      }
    }
  }, [messages, regenerate, sendMessage]);

  const handleEdit = useCallback((message, newText) => {
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx === -1) return;
    // Truncate conversation to before this message, then send edited text
    setMessages(messages.slice(0, idx));
    sendMessage({ text: newText });
  }, [messages, setMessages, sendMessage]);

  // Interactive mode is active if containerName is set
  const isInteractiveActive = !!workspaceState?.containerName;
  const [togglingMode, setTogglingMode] = useState(false);

  const handleInteractiveToggle = useCallback(async (agentOverride) => {
    if (!workspaceState?.id || togglingMode || isInteractiveActive) return;
    setTogglingMode(true);
    try {
      const { startInteractiveMode } = await import('../../code/actions.js');
      // agentOverride is a string agent id when coming from the right-click picker,
      // or undefined when coming from a plain left-click (uses global config default)
      const agent = typeof agentOverride === 'string' ? agentOverride : undefined;
      const result = await startInteractiveMode(workspaceState.id, agent);
      if (result.containerName) {
        setWorkspaceState(prev => ({ ...prev, containerName: result.containerName }));
      }
    } catch (err) {
      console.error('Failed to toggle mode:', err);
    } finally {
      setTogglingMode(false);
    }
  }, [workspaceState?.id, togglingMode, isInteractiveActive]);

  const codeModeSettings = {
    mode: codeModeType,
    onModeChange: setCodeModeType,
    isInteractiveActive,
    onInteractiveToggle: handleInteractiveToggle,
    togglingMode,
    availableAgents,
    hasMessages: messages.length > 0,
  };

  const handleBranchChange = useCallback((newBranch) => {
    setBranch(newBranch);
    if (workspaceState?.id) {
      fetch('/code/workspace-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceState.id, branch: newBranch }),
      }).catch(() => {});
    }
  }, [workspaceState?.id]);

  const handleDiffStatsRefresh = useCallback(async () => {
    if (!workspaceState?.id) return null;
    try {
      const r = await fetch(`/code/workspace-diff/${workspaceState.id}`);
      const data = await r.json();
      if (data.success) {
        setDiffStats(data);
        if (data.currentBranch) {
          setWorkspaceState(prev => prev && data.currentBranch !== prev.featureBranch ? { ...prev, featureBranch: data.currentBranch } : prev);
        }
        return data;
      }
    } catch {}
    return null;
  }, [workspaceState?.id]);

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <ChatHeader chatId={chatId} />
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-2.5 md:px-6">
          <div className="w-full max-w-4xl">
            <Greeting codeMode={codeMode} />
            {error && (
              <div className="mt-4 mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error.message || 'Something went wrong. Please try again.'}
              </div>
            )}
            <div className="mt-4">
              <ChatInput
                input={input}
                setInput={setInput}
                onSubmit={handleSend}
                status={status}
                stop={stop}
                files={files}
                setFiles={setFiles}
                codeMode={codeMode}
                codeModeSettings={codeModeSettings}
              />
            </div>
            <div className="mt-5 pb-8">
              {codeMode && (
                <RepoBranchPicker
                  repo={repo}
                  onRepoChange={setRepo}
                  branch={branch}
                  onBranchChange={handleBranchChange}
                  getRepositories={fetchRepositories}
                  getBranches={fetchBranches}
                  createRepository={fetchCreateRepository}
                />
              )}
              {!codeMode && (
                <ScopePicker
                  scope={scope}
                  onScopeChange={setScope}
                  scopes={availableScopes}
                />
              )}
              <div className="flex flex-wrap items-center justify-center gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    const next = !codeMode;
                    setCodeMode(next);
                    if (next) {
                      // Entering code mode — clear agent mode's default repo
                      setRepo('');
                      setBranch('');
                    } else if (defaultRepo) {
                      setRepo(defaultRepo);
                      setBranch('main');
                    } else {
                      setRepo('');
                      setBranch('');
                    }
                  }}
                  className="inline-flex items-center gap-2 group"
                  role="switch"
                  aria-checked={codeMode}
                  aria-label="Toggle Code mode"
                >
                  <span className={cn(
                    'text-xs transition-colors',
                    !codeMode ? 'font-bold text-foreground' : 'font-medium text-muted-foreground group-hover:text-foreground'
                  )}>
                    Agent
                  </span>
                  <span
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
                      codeMode ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                        codeMode && 'translate-x-4'
                      )}
                    />
                  </span>
                  <span className={cn(
                    'text-xs transition-colors',
                    codeMode ? 'font-bold text-foreground' : 'font-medium text-muted-foreground group-hover:text-foreground'
                  )}>
                    Code
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden relative">
          {showDiff && workspaceState?.id && (
            <div className="absolute inset-0 z-10 bg-black/50" />
          )}
          {showDiff && workspaceState?.id ? (
            <>
              <div className="flex-1 min-h-0 z-20 p-0 md:p-4 flex flex-col">
                <DiffViewer
                  workspaceId={workspaceState.id}
                  diffStats={diffStats}
                  onClose={() => setShowDiff(false)}
                />
              </div>
              <div className="z-20 px-4 pb-4">
                <div className="mx-auto w-full max-w-4xl">
                  {workspaceState && (
                    <div className="rounded-t-xl border border-b-0 border-border px-3 py-2.5 bg-background">
                      <WorkspaceBar
                        repo={repo}
                        branch={branch}
                        onBranchChange={handleBranchChange}
                        getBranches={fetchBranches}
                        workspace={workspaceState}
                        diffStats={diffStats}
                        onDiffStatsRefresh={handleDiffStatsRefresh}
                        onShowDiff={() => setShowDiff(true)}
                      />
                    </div>
                  )}
                  <ChatInput
                    bare
                    input={input}
                    setInput={setInput}
                    onSubmit={handleSend}
                    status={status}
                    stop={stop}
                    files={files}
                    setFiles={setFiles}
                    disabled={isInteractiveActive}
                    placeholder={isInteractiveActive ? 'Interactive mode is active.' : 'Send a message...'}
                    className={workspaceState ? "rounded-t-none" : undefined}
                    codeMode={codeMode}
                    codeModeSettings={codeModeSettings}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <Messages messages={messages} status={status} onRetry={handleRetry} onEdit={handleEdit} />
              {error && (
                <div className="mx-auto w-full max-w-4xl px-2 md:px-4">
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error.message || 'Something went wrong. Please try again.'}
                  </div>
                </div>
              )}
              <div className="mx-auto w-full max-w-4xl px-4 pb-4 md:px-6">
                {isInteractiveActive && (
                  <a
                    href={`/code/${workspaceState?.id}`}
                    className="flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 mb-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                  >
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    Click here to access Interactive Mode
                  </a>
                )}
                {workspaceState && (
                  <div className="rounded-t-xl border border-b-0 border-border px-3 py-2.5">
                    <WorkspaceBar
                      repo={repo}
                      branch={branch}
                      onBranchChange={handleBranchChange}
                      getBranches={fetchBranches}
                      workspace={workspaceState}
                      diffStats={diffStats}
                      onDiffStatsRefresh={handleDiffStatsRefresh}
                      onShowDiff={() => setShowDiff(true)}
                    />
                  </div>
                )}
                <ChatInput
                  bare
                  input={input}
                  setInput={setInput}
                  onSubmit={handleSend}
                  status={status}
                  stop={stop}
                  files={files}
                  setFiles={setFiles}
                  disabled={isInteractiveActive}
                  placeholder={isInteractiveActive ? 'Interactive mode is active.' : 'Send a message...'}
                  className={workspaceState ? "rounded-t-none" : undefined}
                  codeMode={codeMode}
                  codeModeSettings={codeModeSettings}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
