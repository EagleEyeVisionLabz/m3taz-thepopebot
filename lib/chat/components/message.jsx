'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Streamdown } from 'streamdown';
import { cn } from '../utils.js';
import { SpinnerIcon, FileTextIcon, CopyIcon, CheckIcon, RefreshIcon, SquarePenIcon, WrenchIcon, XIcon, ChevronDownIcon } from './icons.js';
import { getToolDisplayName } from './tool-names.js';

function LinkSafetyModal({ url, isOpen, onClose, onConfirm }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [url]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative mx-4 flex w-full flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-lg max-w-[340px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium text-sm text-foreground">Open external link?</div>
        <div className="break-all rounded bg-muted px-2.5 py-2 font-mono text-xs text-foreground">
          {url}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <span>Open</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export const linkSafety = {
  enabled: true,
  renderModal: (props) => <LinkSafetyModal {...props} />,
};

function formatContent(content) {
  if (content == null) return null;
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }
  return JSON.stringify(content, null, 2);
}

function ToolCall({ part, className }) {
  const [expanded, setExpanded] = useState(false);

  const toolName = part.toolName || (part.type?.startsWith('tool-') ? part.type.slice(5) : 'tool');
  const isUnknown = toolName === '__unknown_event__';
  const displayName = isUnknown ? 'Unknown Event' : getToolDisplayName(toolName);
  const state = part.state || 'input-available';

  // Detect tool-level failure: output is valid JSON with success: false
  const hasOutputError = (() => {
    if (state !== 'output-available' || !part.output) return false;
    try {
      const parsed = typeof part.output === 'string' ? JSON.parse(part.output) : part.output;
      return parsed?.success === false;
    } catch { return false; }
  })();

  const isRunning = !isUnknown && (state === 'input-streaming' || state === 'input-available');
  const isDone = !isUnknown && state === 'output-available' && !hasOutputError;
  const isError = state === 'output-error' || hasOutputError;

  // Auto-redirect when start_coding completes successfully.
  // mountedDone captures whether the tool was already finished when the component
  // first rendered (i.e. the user is revisiting a chat). In that case we skip the
  // redirect so they can still read the conversation.
  const mountedDone = useRef(isDone);
  useEffect(() => {
    if (toolName !== 'start_coding' || !isDone || mountedDone.current) return;
    try {
      const output = typeof part.output === 'string' ? JSON.parse(part.output) : part.output;
      if (output?.success && output?.workspaceUrl) {
        // Validate before navigating: only allow same-origin http(s) URLs.
        // workspaceUrl originates from the agent stream and is untrusted, so
        // reject cross-origin destinations and non-http(s) schemes
        // (javascript:/data:/blob:) that could lead to open redirect or script
        // execution.
        const parsed = new URL(output.workspaceUrl, window.location.origin);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.origin === window.location.origin
        ) {
          window.location.href = parsed.href;
        }
      }
    } catch {}
  }, [toolName, isDone, part.output]);

  // Unknown events: red collapsible box
  if (isUnknown) {
    const eventType = part.input?.type || 'unknown';
    return (
      <div className={`my-1 rounded-lg border border-destructive/50 bg-destructive/5${className ? ` ${className}` : ''}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-destructive/10 rounded-lg"
        >
          <XIcon size={14} className="text-destructive shrink-0" />
          <span className="font-medium text-destructive">Unknown Event</span>
          <span className="text-xs text-destructive/70">{eventType}</span>
          <ChevronDownIcon
            size={14}
            className={cn(
              'ml-auto text-destructive/70 transition-transform shrink-0',
              expanded && 'rotate-180'
            )}
          />
        </button>
        {expanded && (
          <div className="border-t border-destructive/30 px-3 py-2 text-xs">
            <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-foreground overflow-x-auto max-h-64 overflow-y-auto">
              {formatContent(part.output || part.input)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`my-1 rounded-lg border border-border bg-background${className ? ` ${className}` : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 rounded-lg"
      >
        <WrenchIcon size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        <span className="flex flex-col min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium text-foreground">{displayName}</span>
            {(() => {
              try {
                // Read from input (available immediately) or output meta (historical chats)
                const agent = part.input?.codingAgent;
                const backend = part.input?.backendApi;
                if (agent || backend) {
                  return (
                    <span className="text-xs text-muted-foreground">
                      {[agent, backend].filter(Boolean).join(' · ')}
                    </span>
                  );
                }
                if (isDone) {
                  const o = typeof part.output === 'string' ? JSON.parse(part.output) : part.output;
                  const meta = Array.isArray(o) ? o.find(e => e.type === 'meta') : o;
                  if (meta?.codingAgent || meta?.backendApi) {
                    return (
                      <span className="text-xs text-muted-foreground">
                        {[meta.codingAgent, meta.backendApi].filter(Boolean).join(' · ')}
                      </span>
                    );
                  }
                }
              } catch {}
              return null;
            })()}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          {isRunning && (
            <>
              <SpinnerIcon size={12} />
              <span>Running...</span>
            </>
          )}
          {isDone && (
            <>
              <CheckIcon size={12} className="text-green-500" />
              <span>Done</span>
            </>
          )}
          {isError && (
            <>
              <XIcon size={12} className="text-red-500" />
              <span>Error</span>
            </>
          )}
        </span>
        <ChevronDownIcon
          size={14}
          className={cn(
            'text-muted-foreground transition-transform shrink-0',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {part.input != null && (
            <div className="mb-2">
              <div className="font-medium text-muted-foreground mb-1">Input</div>
              <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-foreground overflow-x-auto">
                {formatContent(part.input)}
              </pre>
            </div>
          )}
          {part.output != null && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">Output</div>
              <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-foreground overflow-x-auto max-h-64 overflow-y-auto">
                {formatContent(part.output)}
              </pre>
            </div>
          )}
          {part.input == null && part.output == null && (
            <div className="text-muted-foreground italic">Waiting for data...</div>
          )}
        </div>
      )}
    </div>
  );
}

export function PreviewMessage({ message, isLoading, onRetry, onEdit }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const textareaRef = useRef(null);
  const [showWorking, setShowWorking] = useState(false);

  // Extract text from parts (AI SDK v5+) or fall back to content
  const text =
    message.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n') ||
    message.content ||
    '';

  const partsLength = message.parts?.length || 0;
  const textLength = text.length;
  let lastToolPart;
  for (let i = (message.parts?.length || 0) - 1; i >= 0; i--) {
    if (message.parts[i].type?.startsWith('tool-')) { lastToolPart = message.parts[i]; break; }
  }
  const hasRunningTool = (lastToolPart?.state === 'input-streaming' || lastToolPart?.state === 'input-available') || false;

  useEffect(() => {
    if (!isLoading || hasRunningTool) {
      setShowWorking(false);
      return;
    }
    setShowWorking(false);
    const timer = setTimeout(() => setShowWorking(true), 500);
    return () => clearTimeout(timer);
  }, [isLoading, partsLength, textLength, hasRunningTool]);

  // Extract file parts
  const fileParts = message.parts?.filter((p) => p.type === 'file') || [];
  const imageParts = fileParts.filter((p) => p.mediaType?.startsWith('image/'));
  const otherFileParts = fileParts.filter((p) => !p.mediaType?.startsWith('image/'));
  const hasToolParts = message.parts?.some((p) => p.type?.startsWith('tool-')) || false;

  // System messages render as a subtle info banner
  if (isSystem) {
    return (
      <div className="w-full px-4 py-2 rounded-md bg-muted/50 border border-border/50">
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{text}</p>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleEditStart = () => {
    setEditText(text);
    setEditing(true);
  };

  const handleEditCancel = () => {
    setEditing(false);
    setEditText('');
  };

  const handleEditSubmit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== text) {
      onEdit?.(message, trimmed);
    }
    setEditing(false);
    setEditText('');
  };

  // Auto-resize and focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
      // Move cursor to end
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [editing]);

  return (
    <div
      className={cn(
        'group flex gap-4 w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div className={cn('flex flex-col', isUser ? 'max-w-[80%]' : 'w-full')}>
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => {
                setEditText(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleEditSubmit();
                }
                if (e.key === 'Escape') {
                  handleEditCancel();
                }
              }}
              className="w-full resize-none rounded-xl border border-border bg-muted px-4 py-3 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              rows={1}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleEditCancel}
                className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSubmit}
                className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-80"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'text-sm leading-relaxed',
                isUser
                  ? 'rounded-xl px-4 py-3 bg-muted text-foreground'
                  : 'text-foreground'
              )}
            >
              {isUser ? (
                <>
                  {imageParts.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {imageParts.map((part, i) => (
                        <img
                          key={i}
                          src={part.url}
                          alt="attachment"
                          className="max-h-64 max-w-full rounded-lg object-contain"
                        />
                      ))}
                    </div>
                  )}
                  {otherFileParts.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {otherFileParts.map((part, i) => (
                        <div
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs bg-foreground/10"
                        >
                          <FileTextIcon size={12} />
                          <span className="max-w-[150px] truncate">
                            {part.name || part.mediaType || 'file'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {text ? (
                    <div className="whitespace-pre-wrap break-words">{text}</div>
                  ) : null}
                </>
              ) : (
                <>
                  {message.parts?.length > 0 ? (
                    <>
                      {message.parts.map((part, i) => {
                        if (part.type === 'text') {
                          const prevPart = message.parts[i - 1];
                          const afterTool = prevPart?.type?.startsWith('tool-');
                          return <Streamdown key={i} className={afterTool ? 'mt-3' : undefined} mode={isLoading ? 'streaming' : 'static'} linkSafety={linkSafety}>{part.text}</Streamdown>;
                        }
                        if (part.type === 'data-error') {
                          const prevPart = message.parts[i - 1];
                          const afterContent = prevPart?.type === 'text' || prevPart?.type?.startsWith('tool-');
                          return (
                            <div
                              key={i}
                              className={cn(
                                'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive whitespace-pre-wrap break-words',
                                afterContent && 'mt-3'
                              )}
                            >
                              {part.data?.message || 'An error occurred'}
                            </div>
                          );
                        }
                        if (part.type === 'file') {
                          if (part.mediaType?.startsWith('image/')) {
                            return (
                              <div key={i} className="mb-2">
                                <img src={part.url} alt="attachment" className="max-h-64 max-w-full rounded-lg object-contain" />
                              </div>
                            );
                          }
                          return (
                            <div key={i} className="mb-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs bg-foreground/10">
                              <FileTextIcon size={12} />
                              <span className="max-w-[150px] truncate">{part.name || part.mediaType || 'file'}</span>
                            </div>
                          );
                        }
                        if (part.type?.startsWith('tool-')) {
                          const prevPart = message.parts[i - 1];
                          const afterText = prevPart?.type === 'text';
                          return <ToolCall key={part.toolCallId || i} part={part} className={afterText ? 'mt-3' : undefined} />;
                        }
                        return null;
                      })}
                      {showWorking && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <SpinnerIcon size={14} />
                          <span className="thinking-shimmer">Working...</span>
                        </div>
                      )}
                    </>
                  ) : text ? (
                    <Streamdown mode={isLoading ? 'streaming' : 'static'} linkSafety={linkSafety}>{text}</Streamdown>
                  ) : isLoading && !hasToolParts ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <SpinnerIcon size={14} />
                      <span className="thinking-shimmer">Working...</span>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Action toolbar */}
            {!isLoading && text && (
              <div
                className={cn(
                  'flex gap-1 mt-1 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100',
                  isUser ? 'justify-end' : 'justify-start'
                )}
              >
                <button
                  onClick={handleCopy}
                  className="rounded-md p-2 md:p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Copy message"
                >
                  {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                </button>
                {onRetry && (
                  <button
                    onClick={() => onRetry(message)}
                    className="rounded-md p-2 md:p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                    aria-label="Retry"
                  >
                    <RefreshIcon size={14} />
                  </button>
                )}
                {isUser && onEdit && (
                  <button
                    onClick={handleEditStart}
                    className="rounded-md p-2 md:p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                    aria-label="Edit message"
                  >
                    <SquarePenIcon size={14} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ThinkingMessage() {
  return (
    <div className="flex gap-4 w-full justify-start">
      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <SpinnerIcon size={14} />
        <span className="thinking-shimmer">Waiting...</span>
      </div>
    </div>
  );
}
