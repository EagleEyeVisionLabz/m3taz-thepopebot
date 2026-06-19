'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { PlusIcon, CopyIcon, CheckIcon, SpinnerIcon, TrashIcon } from './icons.js';
import { SecretRow, StatusBadge, Dialog, EmptyState } from './settings-shared.js';
import { OAUTH_PROVIDERS } from '../../oauth/providers.js';
import {
  getAgentJobSecrets,
  updateAgentJobSecret,
  deleteAgentJobSecretAction,
  initiateOAuthFlow,
  getOAuthSecretCredentials,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Build flat list of provider/package options for the dropdown
// ─────────────────────────────────────────────────────────────────────────────

function buildProviderOptions() {
  const options = [];
  for (const [providerId, provider] of Object.entries(OAUTH_PROVIDERS)) {
    for (const [packageId, pkg] of Object.entries(provider.packages)) {
      options.push({
        id: `${providerId}:${packageId}`,
        providerId,
        packageId,
        providerName: provider.name,
        packageName: pkg.name,
        label: `${provider.name} > ${pkg.name}`,
        scopes: pkg.scopes,
        authorizeUrl: provider.authorizeUrl,
        tokenUrl: provider.tokenUrl,
      });
    }
  }
  return options;
}

const PROVIDER_OPTIONS = buildProviderOptions();

// ─────────────────────────────────────────────────────────────────────────────
// Searchable provider combobox
// ─────────────────────────────────────────────────────────────────────────────

function ProviderCombobox({ value, onChange, inputClass }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef(null);
  const listRef = useRef(null);

  const selected = PROVIDER_OPTIONS.find((o) => o.id === value);

  const filtered = query
    ? PROVIDER_OPTIONS.filter((o) =>
        o.label.toLowerCase().includes(query.toLowerCase())
      )
    : PROVIDER_OPTIONS;

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && listRef.current) {
      const item = listRef.current.children[highlightIndex];
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, open]);

  const handleSelect = (option) => {
    onChange(option.id);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIndex]) handleSelect(filtered[highlightIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Group filtered options by provider
  const grouped = {};
  for (const opt of filtered) {
    if (!grouped[opt.providerName]) grouped[opt.providerName] = [];
    grouped[opt.providerName].push(opt);
  }

  let flatIndex = -1;

  return (
    <div ref={wrapperRef} className="relative">
      <label className="text-xs font-medium mb-1 block">Provider</label>
      <input
        type="text"
        value={open ? query : (selected ? selected.label : '')}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search providers..."
        className={`${inputClass} font-sans`}
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-background shadow-lg"
        >
          {Object.entries(grouped).map(([providerName, options]) => (
            <div key={providerName}>
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground sticky top-0 bg-background border-b border-border">
                {providerName}
              </div>
              {options.map((opt) => {
                flatIndex++;
                const idx = flatIndex;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      idx === highlightIndex
                        ? 'bg-accent text-foreground'
                        : value === opt.id
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.packageName}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-background shadow-lg px-3 py-2 text-sm text-muted-foreground">
          No providers found
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified add secret dialog (manual + OAuth modes)
// ─────────────────────────────────────────────────────────────────────────────

function AddSecretDialog({ open, onAdd, onCancel, onOAuthSuccess, editingSecret }) {
  // Shared state
  const [mode, setMode] = useState('manual');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  // Manual mode state
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [saving, setSaving] = useState(false);

  // OAuth mode state
  const [selectedOption, setSelectedOption] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // True when the server reports a client secret is already stored for this
  // secret — lets the user re-authorize without re-entering it.
  const [hasStoredSecret, setHasStoredSecret] = useState(false);
  const [scopes, setScopes] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('form'); // form | waiting | success
  const popupRef = useRef(null);
  const timeoutRef = useRef(null);
  const messageCleanupRef = useRef(null);

  // Reset all state on open
  useEffect(() => {
    if (open) {
      setMode(editingSecret ? 'oauth' : 'manual');
      setName(editingSecret?.key || '');
      setError(null);
      // Manual
      setValue('');
      setShowValue(false);
      setSaving(false);
      // OAuth
      setSelectedOption('');
      setClientId('');
      setClientSecret('');
      setHasStoredSecret(false);
      setScopes('');
      setStatus('form');
      setCopied(false);
      setRedirectUri(`${window.location.origin}/api/oauth/callback`);
      if (!editingSecret) setTimeout(() => nameRef.current?.focus(), 50);

      // Pre-fill OAuth metadata from stored secret. The clientSecret is never
      // sent to the browser — the server reuses the stored value on re-authorize
      // (initiateOAuthFlow) when the field is left blank.
      if (editingSecret?.key) {
        getOAuthSecretCredentials(editingSecret.key).then((creds) => {
          if (creds && !creds.error) {
            setClientId(creds.clientId);
            setHasStoredSecret(!!creds.hasClientSecret);
            // Auto-select provider by matching tokenUrl
            const match = PROVIDER_OPTIONS.find((o) => o.tokenUrl === creds.tokenUrl);
            if (match) setSelectedOption(match.id);
          }
        });
      }
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (messageCleanupRef.current) {
        messageCleanupRef.current();
        messageCleanupRef.current = null;
      }
    };
  }, [open]);

  // Clear error on mode switch
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setError(null);
  };

  // Update scopes when provider/package selection changes
  useEffect(() => {
    if (selectedOption) {
      const opt = PROVIDER_OPTIONS.find((o) => o.id === selectedOption);
      if (opt) setScopes(opt.scopes);
    }
  }, [selectedOption]);

  // ── Manual save ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed || !value) return;
    setSaving(true);
    setError(null);
    const result = await onAdd(trimmed, value);
    setSaving(false);
    if (result?.success) {
      onCancel();
    } else {
      setError(result?.error || 'Failed to add secret');
    }
  };

  // ── OAuth flow ───────────────────────────────────────────────────────────

  const handleMessage = useCallback((event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (data?.type === 'oauth-success') {
      setStatus('success');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (messageCleanupRef.current) messageCleanupRef.current();
      onOAuthSuccess();
      setTimeout(() => onCancel(), 1500);
    } else if (data?.type === 'oauth-error') {
      setStatus('form');
      setError(data.detail || 'Authorization failed.');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (messageCleanupRef.current) messageCleanupRef.current();
    }
  }, [onCancel, onOAuthSuccess]);

  // Keep the latest message handler in a ref so the listener registered
  // synchronously in handleAuthorize always invokes current callbacks.
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const handleCopyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAuthorize = async () => {
    const trimmedName = name.trim().toUpperCase();
    // A clientSecret must be supplied unless one is already stored server-side
    // (re-authorize), in which case the server reuses it.
    if (!trimmedName || !selectedOption || !clientId || (!clientSecret && !hasStoredSecret)) return;

    setError(null);
    const opt = PROVIDER_OPTIONS.find((o) => o.id === selectedOption);
    if (!opt) return;

    const result = await initiateOAuthFlow({
      secretName: trimmedName,
      clientId,
      // Omit when empty so the server falls back to the stored secret.
      clientSecret: clientSecret || undefined,
      tokenUrl: opt.tokenUrl,
      scopes,
      secretType: 'agent_job_secret',
      returnPath: '/admin/event-handler/agent-secrets',
    });

    if (result?.error) {
      setError(result.error);
      return;
    }

    // Build the authorize URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: result.redirectUri,
      scope: scopes,
      state: result.state,
      access_type: 'offline',
      prompt: 'consent',
    });
    const authorizeUrl = `${opt.authorizeUrl}?${params.toString()}`;

    // Register the message listener BEFORE opening the popup so the
    // callback's postMessage cannot arrive before the listener is attached.
    if (messageCleanupRef.current) messageCleanupRef.current();
    const listener = (event) => handleMessageRef.current(event);
    window.addEventListener('message', listener);
    messageCleanupRef.current = () => {
      window.removeEventListener('message', listener);
      messageCleanupRef.current = null;
    };

    // Open popup
    popupRef.current = window.open(authorizeUrl, 'oauth-popup', 'width=600,height=700');
    setStatus('waiting');

    // Timeout after 5 minutes
    timeoutRef.current = setTimeout(() => {
      if (status === 'waiting') {
        setStatus('form');
        setError('Authorization timed out. Please try again.');
      }
    }, 5 * 60 * 1000);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground';

  return (
    <Dialog open={open} onClose={onCancel} title={editingSecret ? 'Re-authorize Secret' : 'Add Secret'}>
      {status === 'success' ? (
        <div className="flex items-center justify-center gap-2 py-8 text-green-500">
          <CheckIcon size={20} />
          <span className="text-sm font-medium">Token saved!</span>
        </div>
      ) : status === 'waiting' ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <SpinnerIcon size={20} className="animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Waiting for authorization...</p>
          <p className="text-xs text-muted-foreground">Complete the login in the popup window.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {/* Mode toggle — hidden when re-authorizing */}
            {!editingSecret && (
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleModeChange('manual')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'manual'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('oauth')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                    mode === 'oauth'
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
                >
                  OAuth
                </button>
              </div>
            )}

            {/* Secret name — shared */}
            <div>
              <label className="text-xs font-medium mb-1 block">Name</label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                placeholder={mode === 'manual' ? 'e.g. GOOGLE_SERVICE_ACCOUNT_KEY' : 'e.g. GOOGLE_OAUTH_TOKEN'}
                className={`${inputClass}${editingSecret ? ' text-muted-foreground bg-muted' : ''}`}
                readOnly={!!editingSecret}
                onKeyDown={(e) => e.key === 'Enter' && mode === 'manual' && handleSave()}
              />
            </div>

            {/* Manual mode fields */}
            {mode === 'manual' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium">Value</label>
                  <button
                    type="button"
                    onClick={() => setShowValue(!showValue)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showValue ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showValue ? (
                  <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter value (supports multi-line JSON)..."
                    rows={4}
                    className={`${inputClass} resize-y`}
                  />
                ) : (
                  <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter value (supports multi-line JSON)..."
                    rows={4}
                    className={`${inputClass} resize-y`}
                    style={{ WebkitTextSecurity: 'disc' }}
                  />
                )}
              </div>
            )}

            {/* OAuth mode fields */}
            {mode === 'oauth' && (
              <>
                <ProviderCombobox
                  value={selectedOption}
                  onChange={setSelectedOption}
                  inputClass={inputClass}
                />
                <div>
                  <label className="text-xs font-medium mb-1 block">Redirect URI</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={redirectUri}
                      readOnly
                      className={`${inputClass} text-muted-foreground bg-muted flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleCopyRedirectUri}
                      className="rounded-md px-2.5 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      title="Copy redirect URI"
                    >
                      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Add this URL as a redirect URI in your OAuth app.</p>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Client ID</label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="OAuth client ID"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Client Secret</label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={hasStoredSecret ? '•••••••• (leave blank to keep existing)' : 'OAuth client secret'}
                    className={inputClass}
                  />
                  {hasStoredSecret && (
                    <p className="text-xs text-muted-foreground mt-1">A client secret is already stored. Leave blank to reuse it, or enter a new one to replace it.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Scopes</label>
                  <textarea
                    value={scopes}
                    onChange={(e) => setScopes(e.target.value)}
                    placeholder="Space-separated scopes"
                    rows={3}
                    className={`${inputClass} resize-y`}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Predefined scopes. Edit if needed.</p>
                </div>
              </>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            {mode === 'manual' ? (
              <button onClick={handleSave} disabled={!name.trim() || !value || saving}
                className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save'}
              </button>
            ) : (
              <button
                onClick={handleAuthorize}
                disabled={!name.trim() || !selectedOption || !clientId || (!clientSecret && !hasStoredSecret)}
                className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
              >
                Authorize
              </button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth secret row — Re-authorize instead of inline edit
// ─────────────────────────────────────────────────────────────────────────────

function OAuthSecretRow({ secret, onReauthorize, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    await onDelete();
    setConfirmDelete(false);
  };

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium font-mono">{secret.key}</span>
        <span className="text-xs text-muted-foreground">OAuth</span>
        <StatusBadge isSet={secret.isSet} />
      </div>
      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
        <button
          onClick={onReauthorize}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          Re-authorize
        </button>
        <button
          onClick={handleDelete}
          className={`rounded-md p-1.5 text-xs border transition-colors ${
            confirmDelete
              ? 'border-destructive text-destructive hover:bg-destructive/10'
              : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive'
          }`}
          title={confirmDelete ? 'Click again to confirm' : 'Delete'}
        >
          <TrashIcon size={12} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jobs page
// ─────────────────────────────────────────────────────────────────────────────

export function JobSecretsManager({ showHeader = true }) {
  const [secrets, setSecrets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [reauthorizing, setReauthorizing] = useState(null);

  const loadSecrets = async () => {
    try {
      const result = await getAgentJobSecrets();
      setSecrets(Array.isArray(result) ? result : []);
    } catch {
      setSecrets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSecrets();
  }, []);

  const handleAdd = async (name, value) => {
    const result = await updateAgentJobSecret(name, value);
    if (result?.success) await loadSecrets();
    return result;
  };

  const handleUpdate = async (name, value) => {
    const result = await updateAgentJobSecret(name, value);
    if (result?.success) await loadSecrets();
    return result;
  };

  const handleDelete = async (name) => {
    const result = await deleteAgentJobSecretAction(name);
    if (result?.success) await loadSecrets();
    return result;
  };

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div>
      {showHeader ? (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Job Secrets</h2>
            <p className="text-sm text-muted-foreground">Custom environment variables passed to agent job containers. These are merged with built-in auth credentials when launching jobs.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
            >
              <PlusIcon size={14} />
              Add secret
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
          >
            <PlusIcon size={14} />
            Add secret
          </button>
        </div>
      )}
      <AddSecretDialog
        open={showAdd}
        onAdd={handleAdd}
        onCancel={() => setShowAdd(false)}
        onOAuthSuccess={loadSecrets}
      />
      <AddSecretDialog
        open={!!reauthorizing}
        onAdd={handleAdd}
        onCancel={() => setReauthorizing(null)}
        onOAuthSuccess={loadSecrets}
        editingSecret={reauthorizing}
      />
      {secrets.length === 0 ? (
        <EmptyState
          message="No job secrets configured yet."
          actionLabel="Add secret"
          onAction={() => setShowAdd(true)}
        />
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <div className="divide-y divide-border">
            {secrets.map((s) => s.secretType === 'oauth2' ? (
              <OAuthSecretRow
                key={s.key}
                secret={s}
                onReauthorize={() => setReauthorizing(s)}
                onDelete={() => handleDelete(s.key)}
              />
            ) : (
              <SecretRow
                key={s.key}
                label={s.key}
                mono
                isSet={s.isSet}
                onSave={(val) => handleUpdate(s.key, val)}
                onDelete={() => handleDelete(s.key)}
                icon={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function JobsPage() {
  return <JobSecretsManager />;
}
