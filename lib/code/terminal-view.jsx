'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import { SpinnerIcon, MicIcon } from '../chat/components/icons.js';
import { CommandOutputDialog } from '../chat/components/code-mode-toggle.js';
import { GIT_COMMANDS, getCommandLabel, FALLBACK_BY_MODE } from '../git-commands.js';
import { useVoiceInput } from '../voice/use-voice-input.js';
import { VoiceBars } from '../chat/components/voice-bars.js';

const getVoiceToken = () =>
  fetch('/chat/voice-token').then(r => r.json()).catch(() => ({ error: 'Failed to get voice token' }));

const STATUS = { connected: '#22c55e', connecting: '#eab308', disconnected: '#ef4444' };
const RECONNECT_INTERVAL = 3000;

const TERM_THEMES = {
  dark: { background: '#1a1b26', foreground: '#a9b1d6', cursor: '#c0caf5', selectionBackground: '#33467c' },
  light: { background: '#f5f5f5', foreground: '#171717', cursor: '#171717', selectionBackground: '#d4d4d4' },
};

// Toolbar button colors that contrast with each terminal theme background
const TOOLBAR_COLORS = {
  dark: { color: '#787c99', border: 'rgba(169,177,214,0.15)', hoverColor: '#a9b1d6' },
  light: { color: '#555555', border: 'rgba(23,23,23,0.15)', hoverColor: '#171717' },
};

function getSystemTheme() {
  const cs = getComputedStyle(document.documentElement);
  return {
    background: cs.getPropertyValue('--muted').trim() || '#1a1b26',
    foreground: cs.getPropertyValue('--muted-foreground').trim() || '#a9b1d6',
    cursor: cs.getPropertyValue('--foreground').trim() || '#c0caf5',
    selectionBackground: cs.getPropertyValue('--border').trim() || '#33467c',
  };
}

function resolveTheme(mode) {
  if (mode === 'system') return getSystemTheme();
  return TERM_THEMES[mode] || TERM_THEMES.dark;
}

const THEME_CYCLE = ['dark', 'light', 'system'];

export default function TerminalView({ codeWorkspaceId, wsPath, isActive = true, showToolbar = true, ensureContainer, onCloseSession, closeLabel = 'Close Session', diffStats, onDiffStatsRefresh, onShowDiff, onTerminalOutput }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const retryTimer = useRef(null);
  const statusRef = useRef(null);
  const styleRef = useRef(null);
  const toolbarRef = useRef(null);
  const disconnectedAtRef = useRef(null);
  const ensuredRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [containerError, setContainerError] = useState(null);
  const [termTheme, setTermTheme] = useState('dark');
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [partialText, setPartialText] = useState('');
  const voiceDialogRef = useRef(null);
  const voiceTextareaRef = useRef(null);
  const volumeRef = useRef(0);

  const { voiceAvailable, isConnecting, isRecording, startRecording, stopRecording } = useVoiceInput({
    getToken: getVoiceToken,
    onVolumeChange: (rms) => { volumeRef.current = rms; },
    onTranscript: (text) => {
      setVoiceText((prev) => {
        const needsSpace = prev && !prev.endsWith(' ');
        return prev + (needsSpace ? ' ' : '') + text;
      });
    },
    onPartialTranscript: (text) => setPartialText(text),
    onError: (err) => console.error('[voice]', err),
  });

  const setStatus = useCallback((color) => {
    if (statusRef.current) statusRef.current.style.backgroundColor = color;
    setConnected(color === STATUS.connected);
  }, []);

  const sendResize = useCallback(() => {
    const fit = fitAddonRef.current;
    const ws = wsRef.current;
    const term = termRef.current;
    if (!fit || !term || !ws || ws.readyState !== WebSocket.OPEN) return;
    fit.fit();
    const payload = JSON.stringify({ columns: term.cols, rows: term.rows });
    ws.send('1' + payload);
  }, []);

  const applyTheme = useCallback((mode) => {
    const theme = resolveTheme(mode);
    const tb = TOOLBAR_COLORS[mode] || TOOLBAR_COLORS.dark;
    const term = termRef.current;
    if (term) term.options.theme = theme;
    if (styleRef.current) {
      styleRef.current.textContent = `.xterm { padding: 5px; background-color: ${theme.background} !important; } .xterm-viewport { background-color: ${theme.background} !important; }`;
    }
    if (containerRef.current) containerRef.current.style.backgroundColor = theme.background;
    if (toolbarRef.current) {
      toolbarRef.current.style.background = theme.background;
      toolbarRef.current.style.setProperty('--tb-color', tb.color);
      toolbarRef.current.style.setProperty('--tb-border', tb.border);
      toolbarRef.current.style.setProperty('--tb-hover', tb.hoverColor);
      toolbarRef.current.style.setProperty('--tb-dropup-bg', theme.background);
    }
  }, []);

  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term) return;

    setStatus(STATUS.connecting);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = wsPath || `/code/${codeWorkspaceId}/ws`;
    const ws = new WebSocket(`${protocol}//${window.location.host}${path}`);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const handshake = JSON.stringify({ AuthToken: '', columns: term.cols, rows: term.rows });
      ws.send(handshake);
      setStatus(STATUS.connected);
      // Reset reconnect state on successful connection
      disconnectedAtRef.current = null;
      ensuredRef.current = false;
      setTimeout(sendResize, 100);
    };

    ws.onmessage = (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
      const type = data[0];
      const payload = data.slice(1);

      switch (type) {
        case '0':
          term.write(payload);
          onTerminalOutput?.();
          break;
        case '1':
          // Ignore terminal title changes — global page title is set by layout
          break;
        case '2':
          break;
      }
    };

    ws.onclose = () => {
      setStatus(STATUS.disconnected);

      // Track when disconnection started
      if (!disconnectedAtRef.current) {
        disconnectedAtRef.current = Date.now();
      }

      // Give up after 60s of failed reconnection
      if (Date.now() - disconnectedAtRef.current > 60_000) {
        setContainerError('Failed to connect');
        return;
      }

      // Call ensureContainer once per disconnect cycle to restart the container
      if (!ensuredRef.current && ensureContainer) {
        ensuredRef.current = true;
        ensureContainer(codeWorkspaceId).catch(() => {});
      }

      retryTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [codeWorkspaceId, wsPath, setStatus, ensureContainer]);

  useEffect(() => {
    const saved = localStorage.getItem('terminal-theme') || 'dark';
    setTermTheme(saved);

    const theme = resolveTheme(saved);
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 16,
      fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, monospace',
      theme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    const serializeAddon = new SerializeAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(serializeAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(containerRef.current);

    const style = document.createElement('style');
    style.textContent = `.xterm { padding: 5px; background-color: ${theme.background} !important; } .xterm-viewport { background-color: ${theme.background} !important; touch-action: none; } .xterm-rows span { pointer-events: none; }`;
    containerRef.current.appendChild(style);
    styleRef.current = style;

    containerRef.current.style.backgroundColor = theme.background;
    const tb = TOOLBAR_COLORS[saved] || TOOLBAR_COLORS.dark;
    if (toolbarRef.current) {
      toolbarRef.current.style.background = theme.background;
      toolbarRef.current.style.setProperty('--tb-color', tb.color);
      toolbarRef.current.style.setProperty('--tb-border', tb.border);
      toolbarRef.current.style.setProperty('--tb-hover', tb.hoverColor);
      toolbarRef.current.style.setProperty('--tb-dropup-bg', theme.background);
    }

    fitAddon.fit();

    // Mobile touch scroll: xterm v5's .xterm-viewport is overflow-y:scroll and its
    // scroll event listener syncs scrollTop → buffer position. touch-action:none on
    // the viewport (injected above) prevents the compositor from natively scrolling
    // it, so we manually translate finger swipes into scrollLines() calls. Capture
    // phase + stopPropagation blocks xterm's own touch handlers on .xterm from
    // also setting viewport.scrollTop.
    const termContainer = containerRef.current;
    let lastTouchY = null;
    let touchScrollAccum = 0;
    const LINE_HEIGHT = 15; // approximate px per line at fontSize 16

    const onTouchStart = (ev) => {
      if (ev.touches.length === 1) {
        lastTouchY = ev.touches[0].clientY;
        touchScrollAccum = 0;
      }
      ev.stopPropagation();
    };
    const onTouchMove = (ev) => {
      if (lastTouchY === null || ev.touches.length !== 1) return;
      const currentY = ev.touches[0].clientY;
      const deltaY = lastTouchY - currentY;
      lastTouchY = currentY;
      touchScrollAccum += deltaY;
      const lines = Math.trunc(touchScrollAccum / LINE_HEIGHT);
      if (lines !== 0) {
        term.scrollLines(lines);
        touchScrollAccum -= lines * LINE_HEIGHT;
      }
      ev.preventDefault();
      ev.stopPropagation();
    };
    const onTouchEnd = () => { lastTouchY = null; touchScrollAccum = 0; };

    termContainer.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
    termContainer.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    termContainer.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('0' + data);
      }
    });

    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(sendResize, 100);
    };
    window.addEventListener('resize', handleResize);

    let cancelled = false;

    if (ensureContainer) {
      (async () => {
        try {
          const result = await ensureContainer(codeWorkspaceId);
          if (result?.status === 'error') {
            const msg = result.message || 'Unknown container error';
            console.error('ensureContainer:', msg);
            if (!cancelled) setContainerError(msg);
            return;
          }
        } catch (err) {
          console.error('ensureContainer:', err);
          if (!cancelled) setContainerError(err.message || String(err));
          return;
        }
        if (!cancelled) connect();
      })();
    } else {
      connect();
    }

    return () => {
      cancelled = true;
      clearTimeout(resizeTimeout);
      clearTimeout(retryTimer.current);
      window.removeEventListener('resize', handleResize);
      termContainer.removeEventListener('touchstart', onTouchStart, { capture: true });
      termContainer.removeEventListener('touchmove', onTouchMove, { capture: true });
      termContainer.removeEventListener('touchend', onTouchEnd, { capture: true });
      if (wsRef.current) wsRef.current.close();
      term.dispose();
    };
  }, [connect, sendResize, codeWorkspaceId]);

  useEffect(() => {
    if (isActive && termRef.current && fitAddonRef.current) {
      requestAnimationFrame(() => {
        sendResize();
        termRef.current?.focus();
      });
    }
  }, [isActive, sendResize]);

  const sendCommand = useCallback((text) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const encoder = new TextEncoder();

    // Ctrl+C as binary frame (cancel current input)
    ws.send(new Uint8Array([0x30, 0x03]));

    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Command text as binary frame (no \r)
      const buf = new Uint8Array(text.length * 3 + 1);
      buf[0] = 0x30; // INPUT command
      const { written } = encoder.encodeInto(text, buf.subarray(1));
      ws.send(buf.subarray(0, written + 1));

      // Enter as its own binary frame — separate pty_write() = standalone keystroke
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(new Uint8Array([0x30, 0x0d])); // 0x0d = \r
      }, 50);
    }, 150);
  }, []);

  const handleReconnect = async () => {
    clearTimeout(retryTimer.current);
    if (wsRef.current) wsRef.current.close();
    // Reset reconnect state so the 60s timer starts fresh
    disconnectedAtRef.current = null;
    ensuredRef.current = false;
    if (ensureContainer) {
      try {
        setContainerError(null);
        const result = await ensureContainer(codeWorkspaceId);
        if (result?.status === 'error') {
          const msg = result.message || 'Unknown container error';
          console.error('ensureContainer:', msg);
          setContainerError(msg);
          return;
        }
      } catch (err) {
        console.error('ensureContainer:', err);
        setContainerError(err.message || String(err));
        return;
      }
    }
    connect();
  };

  const cycleTheme = useCallback(() => {
    setTermTheme((prev) => {
      const idx = THEME_CYCLE.indexOf(prev);
      const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
      localStorage.setItem('terminal-theme', next);
      applyTheme(next);
      return next;
    });
  }, [applyTheme]);

  const openVoiceDialog = useCallback(() => {
    setVoiceDialogOpen(true);
    startRecording();
  }, [startRecording]);

  const closeVoiceDialog = useCallback(() => {
    setVoiceDialogOpen(false);
    setPartialText('');
    if (isRecording) stopRecording();
  }, [isRecording, stopRecording]);

  const handleVoiceSubmit = useCallback(() => {
    const text = voiceText.trim();
    if (text) sendCommand(text);
    setVoiceText('');
    setPartialText('');
    closeVoiceDialog();
  }, [voiceText, sendCommand, closeVoiceDialog]);

  // Close voice dialog on outside click
  useEffect(() => {
    if (!voiceDialogOpen) return;
    const handler = (e) => {
      if (voiceDialogRef.current && !voiceDialogRef.current.contains(e.target)) closeVoiceDialog();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [voiceDialogOpen, closeVoiceDialog]);

  // Close voice dialog on Escape
  useEffect(() => {
    if (!voiceDialogOpen) return;
    const handler = (e) => { if (e.key === 'Escape') closeVoiceDialog(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [voiceDialogOpen, closeVoiceDialog]);

  // Auto-scroll voice textarea to bottom as text grows
  useEffect(() => {
    if (voiceTextareaRef.current) {
      voiceTextareaRef.current.scrollTop = voiceTextareaRef.current.scrollHeight;
    }
  }, [voiceText, partialText]);

  const themeIcon = termTheme === 'light' ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="15" />
      <line x1="1" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="15" y2="8" />
      <line x1="3.05" y1="3.05" x2="4.46" y2="4.46" />
      <line x1="11.54" y1="11.54" x2="12.95" y2="12.95" />
      <line x1="3.05" y1="12.95" x2="4.46" y2="11.54" />
      <line x1="11.54" y1="4.46" x2="12.95" y2="3.05" />
    </svg>
  ) : termTheme === 'dark' ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8.5a5.5 5.5 0 1 1-6-6 4.5 4.5 0 0 0 6 6z" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="9" rx="1" />
      <line x1="5" y1="14" x2="11" y2="14" />
      <line x1="8" y1="12" x2="8" y2="14" />
    </svg>
  );

  const themeLabel = termTheme === 'light' ? 'Light' : termTheme === 'dark' ? 'Dark' : 'System';

  return (
    <>
      <style>{`
        .code-toolbar-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: 1px solid var(--tb-border, rgba(169,177,214,0.15));
          color: var(--tb-color, #787c99);
          padding: 5px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
          font-weight: 500;
          letter-spacing: 0.01em;
          transition: all 0.15s ease;
          white-space: nowrap;
          line-height: 1;
        }
        .code-toolbar-btn:hover {
          background: transparent;
          color: var(--tb-hover, #a9b1d6);
        }
        .code-toolbar-btn:active {
          transform: scale(0.97);
        }
        .code-toolbar-btn svg {
          flex-shrink: 0;
        }
        .code-toolbar-btn--diff:hover {
          border-color: rgba(115,218,149,0.3);
          color: #73da95;
          background: rgba(115,218,149,0.08);
        }
        .code-toolbar-btn--command:hover {
          border-color: rgba(122,162,247,0.3);
          color: #7aa2f7;
          background: rgba(122,162,247,0.08);
        }
        .code-toolbar-btn--command-chevron {
          display: inline-flex;
          align-items: center;
          background: transparent;
          border: 1px solid var(--tb-border, rgba(169,177,214,0.15));
          border-left: none;
          color: var(--tb-color, #787c99);
          padding: 5px 6px;
          border-radius: 0 6px 6px 0;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s ease;
          line-height: 1;
        }
        .code-toolbar-btn--command-chevron:hover {
          border-color: rgba(122,162,247,0.3);
          color: #7aa2f7;
          background: rgba(122,162,247,0.08);
        }
        .code-toolbar-dropup {
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 4px;
          background: var(--tb-dropup-bg, #1a1b26);
          border: 1px solid var(--tb-border, rgba(169,177,214,0.15));
          border-radius: 6px;
          padding: 4px 0;
          min-width: 160px;
          z-index: 50;
          box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
        }
        .code-toolbar-dropup-item {
          display: block;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          color: var(--tb-color, #787c99);
          padding: 6px 12px;
          font-size: 12px;
          font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
          cursor: pointer;
          transition: all 0.1s ease;
        }
        .code-toolbar-dropup-item:hover {
          color: #7aa2f7;
          background: rgba(122,162,247,0.08);
        }
        .code-toolbar-btn--reconnect:hover {
          color: var(--tb-hover, #a9b1d6);
        }
        .code-toolbar-btn--theme:hover {
          border-color: rgba(168,153,215,0.3);
          color: #a899d7;
          background: rgba(168,153,215,0.08);
        }
        .code-toolbar-btn--close:hover {
          border-color: rgba(239,68,68,0.3);
          color: #ef4444;
          background: rgba(239,68,68,0.08);
        }
        .code-toolbar-btn--voice:hover {
          border-color: rgba(224,151,110,0.3);
          color: #e0976e;
          background: rgba(224,151,110,0.08);
        }
        .code-toolbar-btn--voice-active {
          border-color: rgba(239,68,68,0.4) !important;
          color: #ef4444 !important;
          background: rgba(239,68,68,0.12) !important;
        }
        @media (max-width: 767px) {
          .code-toolbar-right {
            overflow-x: auto;
          }
        }
        .code-voice-dialog {
          position: absolute;
          bottom: 100%;
          right: 0;
          margin-bottom: 4px;
          background: var(--tb-dropup-bg, #1a1b26);
          border: 1px solid var(--tb-border, rgba(169,177,214,0.15));
          border-radius: 10px;
          padding: 14px;
          width: 420px;
          z-index: 50;
          box-shadow: 0 -6px 24px rgba(0,0,0,0.4);
        }
        @media (max-width: 767px) {
          .code-voice-dialog {
            position: fixed;
            top: 60px;
            left: 8px;
            right: 8px;
            bottom: 60px;
            width: auto;
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
          }
          .code-voice-dialog textarea {
            flex: 1;
            min-height: 0;
          }
        }
        .code-voice-dialog textarea {
          width: 100%;
          background: transparent;
          border: 1px solid var(--tb-border, rgba(169,177,214,0.15));
          border-radius: 6px;
          color: var(--tb-hover, #a9b1d6);
          font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
          font-size: 14px;
          padding: 10px;
          resize: none;
          outline: none;
          line-height: 1.5;
        }
        .code-voice-dialog textarea:focus {
          border-color: rgba(224,151,110,0.4);
        }
        .code-voice-dialog-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 10px;
          gap: 8px;
          flex-shrink: 0;
        }
        .code-voice-submit {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: 1px solid rgba(115,218,149,0.3);
          color: #73da95;
          padding: 5px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
          font-weight: 500;
          transition: all 0.15s ease;
          line-height: 1;
        }
        .code-voice-submit:hover {
          background: rgba(115,218,149,0.08);
          color: #73da95;
        }
        .code-voice-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .code-voice-mic {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          border: 1px solid var(--tb-border, rgba(169,177,214,0.15));
          background: transparent;
          color: var(--tb-color, #787c99);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .code-voice-mic:hover {
          color: var(--tb-hover, #a9b1d6);
        }
        .code-voice-mic--recording {
          background: #ef4444;
          border-color: #ef4444;
          color: white;
        }
        .code-voice-mic--recording:hover {
          background: #dc2626;
          border-color: #dc2626;
          color: white;
        }
        .code-voice-mic--connecting {
          opacity: 0.5;
          cursor: wait;
          animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>

      <div className="mx-4 mb-4" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div style={{ height: '100%', borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
          {(!connected || containerError) && (
            <div style={{
              position: 'absolute',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              background: containerError ? 'rgba(255,235,235,0.95)' : 'var(--muted)',
              color: containerError ? '#991b1b' : 'var(--muted-foreground)',
              padding: '14px 28px',
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace",
              fontWeight: 500,
              border: '1px solid var(--border)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
              zIndex: 10,
              textAlign: 'center',
              maxWidth: 320,
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              {containerError
                ? `Container error: ${containerError}`
                : <><SpinnerIcon size={16} /> Loading...</>}
            </div>
          )}

          {/* Toolbar */}
          {showToolbar && (
          <div
            ref={toolbarRef}
            style={{
              flexShrink: 0,
              height: 42,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
              background: 'var(--muted)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="code-toolbar-btn code-toolbar-btn--theme"
                onClick={cycleTheme}
              >
                {themeIcon}
                {themeLabel}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="code-toolbar-right scrollbar-hide">
              {voiceAvailable && (
                <div ref={voiceDialogRef} style={{ position: 'relative' }}>
                  <button
                    className={`code-toolbar-btn code-toolbar-btn--voice${voiceDialogOpen ? ' code-toolbar-btn--voice-active' : ''}`}
                    onClick={voiceDialogOpen ? closeVoiceDialog : openVoiceDialog}
                    disabled={isConnecting}
                  >
                    {isRecording ? <VoiceBars volumeRef={volumeRef} isRecording={isRecording} /> : <MicIcon size={14} />}
                  </button>
                  {voiceDialogOpen && (
                    <div className="code-voice-dialog">
                      <textarea
                        ref={voiceTextareaRef}
                        rows={6}
                        value={voiceText + (partialText ? (voiceText && !voiceText.endsWith(' ') ? ' ' : '') + partialText : '')}
                        onChange={(e) => { setVoiceText(e.target.value); setPartialText(''); }}
                        placeholder="Listening..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleVoiceSubmit();
                          }
                        }}
                      />
                      <div className="code-voice-dialog-footer">
                        <button
                          className={`code-voice-mic${isRecording ? ' code-voice-mic--recording' : ''}${isConnecting ? ' code-voice-mic--connecting' : ''}`}
                          onClick={isRecording ? stopRecording : startRecording}
                          disabled={isConnecting}
                        >
                          {isRecording ? <VoiceBars volumeRef={volumeRef} isRecording={isRecording} /> : <MicIcon size={14} />}
                        </button>
                        <button
                          className="code-voice-submit"
                          onClick={handleVoiceSubmit}
                          disabled={!voiceText.trim() && !partialText.trim()}
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {diffStats?.currentBranch && (
                <button
                  className="code-toolbar-btn"
                  style={{ cursor: 'default', opacity: 0.7, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={diffStats.currentBranch}
                >
                  {diffStats.currentBranch}
                </button>
              )}
              <ToolbarCommandButton
                codeWorkspaceId={codeWorkspaceId}
                diffStats={diffStats}
                onDiffStatsRefresh={onDiffStatsRefresh}
                onShowDiff={onShowDiff}
              />
              <button
                className="code-toolbar-btn code-toolbar-btn--reconnect"
                onClick={handleReconnect}
              >
                <div
                  ref={statusRef}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: STATUS.connecting,
                    boxShadow: `0 0 6px ${STATUS.connecting}`,
                    transition: 'all 0.3s ease',
                  }}
                />
                Reconnect
              </button>
              <button
                className="code-toolbar-btn code-toolbar-btn--close"
                onClick={onCloseSession}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
                {closeLabel}
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
    </>
  );
}

const STORAGE_KEY = 'thepopebot-workspace-command';

function ToolbarCommandButton({ codeWorkspaceId, diffStats, onDiffStatsRefresh, onShowDiff }) {
  // Resolve chatMode from the workspace's chat (matches code-mode-toggle's per-mode behavior).
  // Defaults to 'code' until the fetch resolves, since code workspaces are most often code-mode.
  const [chatMode, setChatMode] = useState('code');

  useEffect(() => {
    if (!codeWorkspaceId) return;
    let cancelled = false;
    fetch(`/code/${codeWorkspaceId}/chat-data`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.chatMode) setChatMode(data.chatMode);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [codeWorkspaceId]);

  const storageKey = `${STORAGE_KEY}:${chatMode}`;
  const [selectedCommand, setSelectedCommandState] = useState(() => {
    try { return localStorage.getItem(storageKey) || FALLBACK_BY_MODE[chatMode] || 'create-pr'; }
    catch { return FALLBACK_BY_MODE[chatMode] || 'create-pr'; }
  });
  const setSelectedCommand = (cmd) => {
    setSelectedCommandState(cmd);
    try { localStorage.setItem(storageKey, cmd); } catch {}
  };

  // When chatMode resolves (or changes), reload preference from its storage key, then seed from admin default if unset.
  useEffect(() => {
    let stored = null;
    try { stored = localStorage.getItem(storageKey); } catch {}
    if (stored) {
      setSelectedCommandState(stored);
      return;
    }
    let cancelled = false;
    import('../chat/actions.js').then(({ getModeGitActionDefault }) => {
      getModeGitActionDefault(chatMode).then((val) => {
        if (cancelled || !val) return;
        setSelectedCommandState(val);
      }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatMode, storageKey]);
  const [commandRunning, setCommandRunning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [commandOutput, setCommandOutput] = useState('');
  const [commandExitCode, setCommandExitCode] = useState(null);
  const [activeCommand, setActiveCommand] = useState(selectedCommand);
  const [dropupOpen, setDropupOpen] = useState(false);
  const dropupRef = useRef(null);

  // Close dropup on outside click
  useEffect(() => {
    if (!dropupOpen) return;
    const handler = (e) => {
      if (dropupRef.current && !dropupRef.current.contains(e.target)) setDropupOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropupOpen]);

  const handleRun = useCallback(async () => {
    if (commandRunning) return;

    setCommandRunning(true);
    setDialogOpen(true);
    setCommandOutput('');
    setCommandExitCode(null);
    setActiveCommand(selectedCommand);
    try {
      const { runWorkspaceCommand } = await import('./actions.js');
      const result = await runWorkspaceCommand(codeWorkspaceId, selectedCommand);
      setCommandOutput(result.output || result.message || '');
      setCommandExitCode(result.exitCode ?? (result.success ? 0 : 1));
      onDiffStatsRefresh?.();
    } catch (err) {
      setCommandOutput(err.message || 'Command failed');
      setCommandExitCode(1);
    } finally {
      setCommandRunning(false);
    }
  }, [codeWorkspaceId, selectedCommand, commandRunning, diffStats, onDiffStatsRefresh]);

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  return (
    <>
      <button
        className="code-toolbar-btn code-toolbar-btn--diff"
        onClick={onShowDiff}
      >
        <span style={{ color: '#73da95' }}>+{diffStats?.insertions ?? 0}</span>
        <span style={{ color: '#ef4444' }}>-{diffStats?.deletions ?? 0}</span>
      </button>
      <div style={{ position: 'relative' }} ref={dropupRef}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            className="code-toolbar-btn code-toolbar-btn--command"
            style={{ borderRadius: '6px 0 0 6px' }}
            onClick={commandRunning ? () => setDialogOpen(true) : handleRun}
            title={commandRunning ? 'View logs' : undefined}
          >
            {commandRunning && <SpinnerIcon size={12} />}
            {getCommandLabel(commandRunning ? activeCommand : selectedCommand)}
          </button>
          <button
            className="code-toolbar-btn--command-chevron"
            onClick={() => setDropupOpen((v) => !v)}
            disabled={commandRunning}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 10 8 6 12 10" />
            </svg>
          </button>
        </div>
        {dropupOpen && (
          <div className="code-toolbar-dropup">
            {GIT_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                className="code-toolbar-dropup-item"
                onClick={() => { setSelectedCommand(cmd); setDropupOpen(false); }}
              >
                {getCommandLabel(cmd)}
              </button>
            ))}
          </div>
        )}
      </div>

      {dialogOpen && (
        <CommandOutputDialog
          title={getCommandLabel(activeCommand)}
          output={commandOutput}
          exitCode={commandExitCode}
          running={commandRunning}
          onClose={handleDialogClose}
        />
      )}
    </>
  );
}
