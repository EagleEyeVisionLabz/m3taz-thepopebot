'use client';

import { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { html as diff2html, parse as diff2htmlParse } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

/**
 * Diff viewer overlay — two-panel layout with file list on left, unified diff on right.
 * Positioned absolutely within the chat content area.
 *
 * @param {object} props
 * @param {string} props.workspaceId - Workspace ID to fetch diff for
 * @param {object} props.diffStats - Current diff stats ({ insertions, deletions })
 * @param {Function} props.onClose - Callback to close the viewer
 */
export function DiffViewer({ workspaceId, diffStats, onClose }) {
  const { resolvedTheme } = useTheme();
  const [diffHtml, setDiffHtml] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const diffRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/code/workspace-diff/${workspaceId}/full`)
      .then(r => r.json())
      .then(r => {
        if (cancelled) return;
        if (!r.success || !r.diff) {
          setError('No changes found');
          return;
        }
        const colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';
        const rendered = diff2html(r.diff, {
          outputFormat: 'line-by-line',
          drawFileList: false,
          colorScheme,
          matching: 'lines',
          diffStyle: 'word',
        });
        setDiffHtml(rendered);

        const parsed = diff2htmlParse(r.diff);
        setFiles(parsed.map(f => ({
          name: f.newName === '/dev/null' ? f.oldName : f.newName,
          added: f.addedLines,
          deleted: f.deletedLines,
          isNew: f.oldName === '/dev/null',
          isDeleted: f.newName === '/dev/null',
        })));
      })
      .catch(() => {
        if (cancelled) return;
        setError('Failed to load diff');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId, resolvedTheme]);

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Scroll to a file's diff section
  const scrollToFile = (fileName) => {
    if (!diffRef.current) return;
    const headers = diffRef.current.querySelectorAll('.d2h-file-header');
    for (const header of headers) {
      const nameEl = header.querySelector('.d2h-file-name');
      if (nameEl && nameEl.textContent.trim().includes(fileName)) {
        header.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold">Diff</span>
          {diffStats && (
            <span className="text-sm font-medium">
              <span className="text-green-500">+{diffStats.insertions}</span>
              {' '}
              <span className="text-destructive">-{diffStats.deletions}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      {/* Two-panel content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* File list — left panel */}
        <div className="hidden md:block w-48 shrink-0 border-r border-border overflow-y-auto">
          <div className="px-3 py-2 text-xs text-muted-foreground font-medium">
            Files Changed{files.length > 0 ? ` ${files.length}` : ''}
          </div>
          <div className="px-1 pb-2">
            {files.map((file) => (
              <button
                key={file.name}
                type="button"
                onClick={() => scrollToFile(file.name)}
                className="w-full text-left px-2 py-1 text-xs rounded hover:bg-accent transition-colors flex items-center justify-between gap-2"
              >
                <span className="truncate font-mono">{file.name}</span>
                <span className="shrink-0 text-[10px] font-medium whitespace-nowrap">
                  {file.added > 0 && <span className="text-green-500">+{file.added}</span>}
                  {file.added > 0 && file.deleted > 0 && ' '}
                  {file.deleted > 0 && <span className="text-destructive">-{file.deleted}</span>}
                  {file.added === 0 && file.deleted === 0 && <span className="text-muted-foreground">0</span>}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Diff content — right panel */}
        <div className="flex-1 overflow-y-auto" ref={diffRef}>
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground text-sm">Loading diff...</div>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground text-sm">{error}</div>
            </div>
          )}
          {diffHtml && (
            <>
              <style>{`
                .diff-viewer-content .d2h-diff-table tr { position: relative; }
              `}</style>
              <div
                className="diff-viewer-content p-4"
                dangerouslySetInnerHTML={{ __html: diffHtml }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
