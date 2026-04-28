'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GitBranchIcon, ChevronDownIcon, SpinnerIcon, XIcon, PlusIcon } from './icons.js';
import { Combobox } from './ui/combobox.js';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu.js';
import { cn } from '../utils.js';
import { CodeLogView } from './code-log-view.js';

/**
 * Auto-generates display labels from command slug.
 * Splits on hyphens, capitalizes each word. Words ≤2 chars are uppercased (e.g. pr → PR).
 */
export function getCommandLabel(slug) {
  return slug
    .split('-')
    .map(word => word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Repo/branch picker dropdowns for the empty state (below chat input).
 * Only rendered when codeMode is on and no messages have been sent.
 */
export function RepoBranchPicker({
  repo,
  onRepoChange,
  branch,
  onBranchChange,
  getRepositories,
  getBranches,
  createRepository,
}) {
  const [repos, setRepos] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Load repos eagerly on mount
  useEffect(() => {
    setLoadingRepos(true);
    getRepositories().then((data) => {
      const list = data || [];
      setRepos(list);
      setReposLoaded(true);
      setLoadingRepos(false);
      if (list.length === 1) {
        onRepoChange(list[0].full_name);
      }
    }).catch(() => setLoadingRepos(false));
  }, []);

  // Load branches when repo changes
  useEffect(() => {
    if (!repo) return;
    setLoadingBranches(true);
    setBranches([]);
    getBranches(repo).then((data) => {
      const branchList = data || [];
      setBranches(branchList);
      const defaultBranch = branchList.find((b) => b.isDefault);
      if (defaultBranch) {
        onBranchChange(defaultBranch.name);
      }
      setLoadingBranches(false);
    }).catch(() => setLoadingBranches(false));
  }, [repo]);

  const handleRepoCreated = useCallback((fullName) => {
    setRepos((prev) => [...prev, { full_name: fullName, default_branch: 'main' }]);
    onRepoChange(fullName);
  }, [onRepoChange]);

  const repoOptions = repos.map((r) => ({ value: r.full_name, label: r.full_name }));
  const branchOptions = branches.map((b) => ({ value: b.name, label: b.name }));

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <div className="w-full sm:w-auto sm:min-w-[240px] sm:max-w-[240px]">
        <Combobox
          options={repoOptions}
          value={repo}
          onChange={onRepoChange}
          placeholder="Select repository..."
          loading={loadingRepos}
          highlight={!repo && !loadingRepos}
          footerAction={createRepository ? {
            icon: <PlusIcon size={14} />,
            label: 'Create new repository...',
            onClick: () => setShowCreateDialog(true),
          } : undefined}
        />
      </div>
      <div className={cn("w-full sm:w-auto sm:min-w-[200px] sm:max-w-[200px]", !repo && "opacity-50 pointer-events-none")}>
        <Combobox
          options={branchOptions}
          value={branch}
          onChange={onBranchChange}
          placeholder="Select branch..."
          loading={loadingBranches}
          highlight={!!repo && !branch && !loadingBranches}
        />
      </div>
      {showCreateDialog && (
        <CreateRepoDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleRepoCreated}
          createRepository={createRepository}
        />
      )}
    </div>
  );
}

function CreateRepoDialog({ onClose, onCreate, createRepository }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const repo = await createRepository(trimmed);
      onCreate(repo.full_name);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create repository');
      setCreating(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-50 w-full max-w-md mx-4 rounded-lg border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">Create Repository</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <XIcon size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-muted-foreground mb-1.5">Repository name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
            className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:text-foreground rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 rounded-md transition-colors"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

/**
 * Workspace toolbar bar with branch info, diff stats, and command buttons.
 * Only rendered when a workspace exists (after first message creates one).
 */
export function WorkspaceBar({
  repo,
  branch,
  onBranchChange,
  getBranches,
  workspace,
  diffStats,
  onDiffStatsRefresh,
  onShowDiff,
  chatMode = 'agent',
  autoRunInfo = null,
}) {
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const featureBranch = workspace?.featureBranch;
  const repoName = repo ? repo.split('/').pop() : '';

  return (
    <div className="flex items-center gap-2 text-xs min-w-0 px-1 py-0.5">
      <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
        <GitBranchIcon size={12} className="shrink-0" />
        {repoName && <span className="shrink-0 cursor-default hidden md:inline" title={repo}>{repoName}</span>}
        {branch && (
          <>
            <span className="shrink-0 text-muted-foreground/30 hidden md:inline">/</span>
            <div className="min-w-0">
              <Combobox
                options={branches.map((b) => ({ value: b.name, label: b.name }))}
                value={branch}
                onChange={onBranchChange}
                loading={loadingBranches}
                side="top"
                onOpen={() => {
                  if (!loadingBranches && repo) {
                    setLoadingBranches(true);
                    getBranches(repo).then((data) => {
                      setBranches(data || []);
                    }).catch(() => {
                      setBranches([]);
                    }).finally(() => setLoadingBranches(false));
                  }
                }}
                triggerClassName="inline-block max-w-[70px] md:max-w-[160px] text-left font-medium text-foreground hover:text-primary hover:bg-accent transition-colors cursor-pointer truncate text-xs rounded px-1 -mx-1 align-middle"
                triggerLabel={<span title={branch}>{branch}</span>}
              />
            </div>
          </>
        )}
        {featureBranch && featureBranch !== branch && (
          <>
            <span className="shrink-0 text-muted-foreground/50">&larr;</span>
            <span className="text-primary truncate min-w-0 cursor-default" title={featureBranch}>{featureBranch}</span>
          </>
        )}
      </div>
      {workspace?.id && <WorkspaceCommandButton workspaceId={workspace.id} diffStats={diffStats} onDiffStatsRefresh={onDiffStatsRefresh} onShowDiff={onShowDiff} chatMode={chatMode} autoRunInfo={autoRunInfo} />}
    </div>
  );
}

export function CommandOutputDialog({ title, logs, exitCode, running, onClose }) {
  const outputRef = useRef(null);

  // Lock body scroll while dialog is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs?.length]);

  // Close on Escape — works whether running or not.
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-lg w-full max-w-xl mx-4 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {running && (
              <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div ref={outputRef} className="flex-1 overflow-auto p-4 min-h-[120px] font-mono text-xs">
          {logs?.length > 0 ? (
            <CodeLogView logs={logs} />
          ) : running ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerIcon size={14} className="animate-spin" />
              Starting...
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No output</span>
          )}
        </div>

        {/* Footer */}
        {!running && exitCode !== null && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className={cn('text-xs font-medium', exitCode === 0 ? 'text-green-500' : 'text-destructive')}>
              {exitCode === 0 ? 'Completed' : `Exited with code ${exitCode}`}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const STORAGE_KEY = 'thepopebot-workspace-command';
const FALLBACK_BY_MODE = { agent: 'push', code: 'create-pr' };

function WorkspaceCommandButton({ workspaceId, diffStats, onDiffStatsRefresh, onShowDiff, chatMode = 'agent', autoRunInfo = null }) {
  const storageKey = `${STORAGE_KEY}:${chatMode}`;
  const [selectedCommand, setSelectedCommandState] = useState(() => {
    try { return localStorage.getItem(storageKey) || FALLBACK_BY_MODE[chatMode] || 'create-pr'; }
    catch { return FALLBACK_BY_MODE[chatMode] || 'create-pr'; }
  });
  const setSelectedCommand = (cmd) => {
    setSelectedCommandState(cmd);
    try { localStorage.setItem(storageKey, cmd); } catch {}
  };

  // If user hasn't picked anything for this mode yet, seed from admin default.
  useEffect(() => {
    let stored = null;
    try { stored = localStorage.getItem(storageKey); } catch {}
    if (stored) return;
    let cancelled = false;
    import('../actions.js').then(({ getModeGitActionDefault }) => {
      getModeGitActionDefault(chatMode).then((val) => {
        if (cancelled || !val) return;
        setSelectedCommandState(val);
      }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatMode, storageKey]);

  // Unified run state — manual click and server auto-run share this state
  // machine. They differ only in (a) who launches the container and
  // (b) whether the dialog opens automatically.
  const [running, setRunning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [commandLogs, setCommandLogs] = useState([]);
  const [commandExitCode, setCommandExitCode] = useState(null);
  const [activeCommand, setActiveCommand] = useState(selectedCommand);
  const esRef = useRef(null);
  const consumedAutoRunRef = useRef(null);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, []);

  const attachLogStream = useCallback((containerName) => {
    const es = new EventSource(`/stream/containers/logs?name=${encodeURIComponent(containerName)}&cleanup=true`);
    esRef.current = es;

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        setCommandLogs((prev) => [...prev, data]);
      } catch {}
    });

    es.addEventListener('exit', (e) => {
      let code = -1;
      try { code = JSON.parse(e.data).exitCode; } catch {}
      setCommandExitCode(code);
      setRunning(false);
      es.close();
      esRef.current = null;
      onDiffStatsRefresh?.();
      // Force-open the dialog on failure so the user sees what happened.
      if (code !== 0) setDialogOpen(true);
    });

    es.addEventListener('error', () => {
      es.close();
      esRef.current = null;
      setRunning(false);
      setCommandExitCode((prev) => prev === null ? -1 : prev);
    });
  }, [onDiffStatsRefresh]);

  // Server-side auto-run: container is already launched, just attach.
  useEffect(() => {
    if (!autoRunInfo?.containerName) return;
    if (consumedAutoRunRef.current === autoRunInfo.id) return;
    consumedAutoRunRef.current = autoRunInfo.id;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setRunning(true);
    setDialogOpen(false);
    setCommandLogs([]);
    setCommandExitCode(null);
    setActiveCommand(autoRunInfo.command || selectedCommand);
    attachLogStream(autoRunInfo.containerName);
  }, [autoRunInfo, attachLogStream, selectedCommand]);

  const handleRun = useCallback(async () => {
    if (running) return;

    setRunning(true);
    setDialogOpen(true);
    setCommandLogs([]);
    setCommandExitCode(null);
    setActiveCommand(selectedCommand);

    try {
      const { launchWorkspaceCommand } = await import('../../code/actions.js');
      const launch = await launchWorkspaceCommand(workspaceId, selectedCommand);

      if (!launch.success) {
        setCommandLogs([{ stream: 'stderr', raw: launch.message || 'Failed to launch', parsed: [{ type: 'text', text: launch.message || 'Failed to launch' }] }]);
        setCommandExitCode(1);
        setRunning(false);
        return;
      }

      attachLogStream(launch.containerName);
    } catch (err) {
      setCommandLogs([{ stream: 'stderr', raw: err.message || 'Command failed', parsed: [{ type: 'text', text: err.message || 'Command failed' }] }]);
      setCommandExitCode(1);
      setRunning(false);
    }
  }, [workspaceId, selectedCommand, running, attachLogStream]);

  const handleSpinnerClick = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  return (
    <div className="ml-auto flex items-center">
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onShowDiff}
          className="text-xs leading-4 px-2.5 h-[28px] flex items-center gap-1.5 font-medium border border-border rounded-md whitespace-nowrap hover:bg-accent transition-colors cursor-pointer"
        >
          <span className="text-green-500">+{diffStats?.insertions ?? 0}</span>
          <span className="text-destructive">-{diffStats?.deletions ?? 0}</span>
        </button>
        {running && (
          <button
            type="button"
            onClick={handleSpinnerClick}
            title="View logs"
            aria-label="View logs"
            className="h-[28px] w-[28px] flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <SpinnerIcon size={12} className="animate-spin" />
          </button>
        )}
        <div className="flex items-center">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="text-xs leading-4 px-2.5 h-[28px] font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors rounded-l-md disabled:opacity-50"
          >
            {getCommandLabel(selectedCommand)}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                type="button"
                disabled={running}
                className="text-xs leading-4 px-1.5 h-[28px] font-medium border border-border border-l-0 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors rounded-r-md disabled:opacity-50 flex items-center"
              >
                <ChevronDownIcon size={14} />
              </button>
            </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="whitespace-nowrap">
            {['commit', 'push', 'create-pr'].map((cmd) => (
              <DropdownMenuItem key={cmd} onClick={() => setSelectedCommand(cmd)}>
                {getCommandLabel(cmd)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {['pull'].map((cmd) => (
              <DropdownMenuItem key={cmd} onClick={() => setSelectedCommand(cmd)}>
                {getCommandLabel(cmd)}
              </DropdownMenuItem>
            ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {dialogOpen && (
        <CommandOutputDialog
          title={getCommandLabel(activeCommand)}
          logs={commandLogs}
          exitCode={commandExitCode}
          running={running}
          onClose={handleDialogClose}
        />
      )}
    </div>
  );
}
