'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowUpCircleIcon, SpinnerIcon, CheckIcon, XIcon, RefreshIcon } from './icons.js';
import { triggerUpgrade } from '../actions.js';

export function UpgradeDialog({ open, onClose, version, updateAvailable, changelog }) {
  const [upgrading, setUpgrading] = useState(false);
  const [result, setResult] = useState(null);

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, handleClose]);

  useEffect(() => {
    if (!open) {
      setUpgrading(false);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const handleUpgrade = async () => {
    setUpgrading(true);
    setResult(null);
    try {
      await triggerUpgrade();
      setResult('success');
    } catch {
      setResult('error');
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative z-50 w-full max-w-md mx-4 rounded-lg border border-border bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        {result === 'success' ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Upgrade Initiated</h3>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                <XIcon size={16} />
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-emerald-500/10 shrink-0">
                <CheckIcon size={20} className="text-emerald-500" />
              </div>
              <p className="text-sm font-medium">
                Upgrading to <span className="font-mono text-emerald-500">v{updateAvailable}</span>
              </p>
            </div>

            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                The upgrade process has been triggered and could take{' '}
                <strong className="text-foreground">5–10 minutes</strong> to complete.
              </p>
              <p>
                You can monitor progress from the{' '}
                <a href="/containers" className="text-emerald-500 hover:underline font-medium">Containers</a> page.
              </p>
              <p>
                The site may be briefly unresponsive for a few seconds when the server restarts.
              </p>
              <p>
                Some files (prompts, crons, triggers) won't be auto-updated to avoid breaking your bot.{' '}
                <a
                  href="https://github.com/stephengpope/thepopebot?tab=readme-ov-file#understanding-init"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-500 hover:underline"
                >
                  Learn more
                </a>.
              </p>
            </div>

            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                If you hit unrecoverable errors, see the{' '}
                <a
                  href="https://github.com/stephengpope/thepopebot?tab=readme-ov-file#manual-updating"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-500 hover:underline"
                >
                  manual update guide
                </a>.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Upgrade Available</h3>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
                <XIcon size={16} />
              </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <ArrowUpCircleIcon size={24} />
              <div>
                <p className="text-sm text-muted-foreground">Installed version</p>
                <p className="text-lg font-mono font-semibold">v{version}</p>
              </div>
            </div>

            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 mb-4">
              <p className="text-sm font-medium">
                Version <span className="font-mono text-emerald-500">v{updateAvailable}</span> is available
              </p>
            </div>

            {changelog && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">What's new</p>
                <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {changelog}
                </div>
              </div>
            )}

            <button
              onClick={handleUpgrade}
              disabled={upgrading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:pointer-events-none"
            >
              {upgrading ? (
                <>
                  <SpinnerIcon size={16} />
                  Triggering upgrade...
                </>
              ) : result === 'error' ? (
                <>
                  <RefreshIcon size={16} />
                  Retry
                </>
              ) : (
                <>
                  <ArrowUpCircleIcon size={16} />
                  Upgrade to v{updateAvailable}
                </>
              )}
            </button>

            {result === 'error' && (
              <p className="text-xs text-destructive mt-3">
                Failed to trigger the upgrade workflow. Check that your GitHub token has workflow permissions.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
