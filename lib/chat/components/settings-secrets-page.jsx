'use client';

import { useState, useEffect } from 'react';
import { KeyIcon, CopyIcon, CheckIcon, TrashIcon, PlusIcon } from './icons.js';
import { SecretRow, EmptyState, formatDate, timeAgo } from './settings-shared.js';
import {
  createNewApiKey,
  getApiKeys,
  deleteApiKey,
  getApiKeySettings,
  updateApiKeySetting,
  regenerateWebhookSecret,
  getTelegramStatus,
  validateTelegramToken,
  registerTelegramWebhook,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Keys sub-tab — Multiple named API keys
// ─────────────────────────────────────────────────────────────────────────────

export function ApiKeysListPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState(null);

  const loadKeys = async () => {
    try {
      const result = await getApiKeys();
      setKeys(Array.isArray(result) ? result : result ? [result] : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const handleCreate = async () => {
    if (creating || !newKeyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createNewApiKey(newKeyName.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setNewKey(result.key);
        setNewKeyName('');
        setShowCreateForm(false);
        await loadKeys();
      }
    } catch {
      setError('Failed to create API key');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    try {
      await deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setConfirmDelete(null);
      if (newKey) setNewKey(null);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-md bg-border/50" />
        <div className="h-16 animate-pulse rounded-md bg-border/50" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-medium">API Keys</h2>
          <p className="text-sm text-muted-foreground">Authenticate external requests to /api endpoints via the x-api-key header.</p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
          >
            <PlusIcon size={14} />
            Create key
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive mb-4">{error}</p>
      )}

      {/* Create form */}
      {showCreateForm && (
        <div className="rounded-lg border border-dashed bg-card p-4 mb-4">
          <label className="text-xs font-medium mb-1.5 block">Key name</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. n8n, production, staging..."
              autoFocus
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={!newKeyName.trim() || creating}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreateForm(false); setNewKeyName(''); }}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* New key banner */}
      {newKey && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <p className="text-sm font-medium text-green-500">
              API key created — copy it now. You won't be able to see it again.
            </p>
            <button
              onClick={() => setNewKey(null)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            >
              Dismiss
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all">
              {newKey}
            </code>
            <CopyButton text={newKey} />
          </div>
        </div>
      )}

      {/* Key list */}
      {keys.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <div className="divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4">
                <div className="flex items-center gap-2">
                  <KeyIcon size={14} className="text-muted-foreground shrink-0" />
                  <div>
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {k.keyPrefix}...
                    <span className="font-sans ml-2">
                      Created {formatDate(k.createdAt)}
                      <span> · {k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : 'Never used'}</span>
                    </span>
                  </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(k.id)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium border shrink-0 self-start sm:self-auto transition-colors ${
                    confirmDelete === k.id
                      ? 'border-destructive text-destructive hover:bg-destructive/10'
                      : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive/50'
                  }`}
                >
                  <TrashIcon size={12} />
                  {confirmDelete === k.id ? 'Confirm' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : !showCreateForm && (
        <EmptyState
          message="No API keys configured"
          actionLabel="Create API key"
          onAction={() => setShowCreateForm(true)}
        />
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice sub-tab — AssemblyAI API Key
// ─────────────────────────────────────────────────────────────────────────────

export function ApiKeysVoicePage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    try {
      const result = await getApiKeySettings();
      setSettings(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const getStatus = (key) => settings?.secrets?.find((s) => s.key === key)?.isSet || false;

  const handleSave = async (key, value) => {
    setSaving(true);
    await updateApiKeySetting(key, value);
    await loadSettings();
    setSaving(false);
  };

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Voice</h2>
        <p className="text-sm text-muted-foreground">Required for voice input in chat.</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <SecretRow
          label="AssemblyAI API Key"
          isSet={getStatus('ASSEMBLYAI_API_KEY')}
          saving={saving}
          onSave={(val) => handleSave('ASSEMBLYAI_API_KEY', val)}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram sub-tab — Guided setup (bot token → webhook → chat verification)
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ n, state }) {
  // state: 'done' | 'active' | 'pending'
  const cls =
    state === 'done'
      ? 'bg-green-500 text-white border-green-500'
      : state === 'active'
        ? 'border-foreground text-foreground'
        : 'border-border text-muted-foreground';
  return (
    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${cls}`}>
      {state === 'done' ? <CheckIcon className="h-3 w-3" /> : n}
    </div>
  );
}

export function ApiKeysTelegramPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Step 1 — bot token
  const [tokenInput, setTokenInput] = useState('');
  const [tokenEditing, setTokenEditing] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState(null);

  // Step 2 — webhook
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookError, setWebhookError] = useState(null);
  const [webhookEditing, setWebhookEditing] = useState(false);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');

  const loadStatus = async () => {
    try {
      const result = await getTelegramStatus();
      setStatus(result);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // Keep the webhook URL input in sync with the saved/effective URL when not
  // actively editing — covers the "unregistered" case where the field needs
  // to be prefilled with the default so the user can just hit Register.
  useEffect(() => {
    if (!status || webhookEditing) return;
    setWebhookUrlInput(
      status.webhookUrlOverride || status.webhookInfo?.url || status.defaultWebhookUrl || ''
    );
  }, [status, webhookEditing]);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  const step1Done = !!status.botInfo;
  const step2Done = step1Done && status.webhookInfo?.url;

  // Step 1 handlers
  const handleSaveToken = async () => {
    setTokenSaving(true);
    setTokenError(null);
    const validation = await validateTelegramToken(tokenInput.trim());
    if (!validation.valid) {
      setTokenError(validation.error || 'Invalid token');
      setTokenSaving(false);
      return;
    }
    const saveResult = await updateApiKeySetting('TELEGRAM_BOT_TOKEN', tokenInput.trim());
    if (saveResult?.error) {
      setTokenError(saveResult.error);
      setTokenSaving(false);
      return;
    }
    setTokenInput('');
    setTokenEditing(false);
    await loadStatus();
    setTokenSaving(false);
  };

  const handleClearToken = async () => {
    setTokenSaving(true);
    await updateApiKeySetting('TELEGRAM_BOT_TOKEN', '');
    await loadStatus();
    setTokenSaving(false);
  };

  // Step 2 handlers
  const handleRegisterWebhook = async () => {
    setWebhookSaving(true);
    setWebhookError(null);
    const url = webhookEditing ? webhookUrlInput.trim() : undefined;
    const result = await registerTelegramWebhook(url);
    if (result?.error) {
      setWebhookError(result.error);
      setWebhookSaving(false);
      return;
    }
    setWebhookEditing(false);
    setWebhookUrlInput('');
    await loadStatus();
    setWebhookSaving(false);
  };

  const startWebhookEdit = () => {
    setWebhookError(null);
    setWebhookUrlInput(
      status.webhookUrlOverride || status.webhookInfo?.url || status.defaultWebhookUrl || ''
    );
    setWebhookEditing(true);
  };

  const cancelWebhookEdit = () => {
    setWebhookEditing(false);
    setWebhookUrlInput('');
    setWebhookError(null);
  };

  const resetWebhookToDefault = () => {
    setWebhookUrlInput(status.defaultWebhookUrl || '');
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-medium">Telegram</h2>
        <p className="text-sm text-muted-foreground">
          Connect a Telegram bot to receive and send messages through your agent.
        </p>
      </div>

      <div className="space-y-3">
        {/* ─── Step 1: Bot Token ─── */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <StepIndicator n={1} state={step1Done ? 'done' : 'active'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Bot Token</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Create a bot with{' '}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      @BotFather
                    </a>{' '}
                    and paste the token below.
                  </p>
                </div>
                {step1Done && !tokenEditing && (
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium">@{status.botInfo.username}</div>
                    <button
                      onClick={() => setTokenEditing(true)}
                      className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>

              {(!step1Done || tokenEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
                    onKeyDown={(e) => e.key === 'Enter' && tokenInput.trim() && handleSaveToken()}
                  />
                  {tokenError && <div className="text-xs text-destructive">{tokenError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveToken}
                      disabled={tokenSaving || !tokenInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {tokenSaving ? 'Validating...' : 'Validate & Save'}
                    </button>
                    {tokenEditing && (
                      <button
                        onClick={() => {
                          setTokenEditing(false);
                          setTokenInput('');
                          setTokenError(null);
                        }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {step1Done && tokenEditing && (
                      <button
                        onClick={handleClearToken}
                        className="ml-auto rounded-md border border-destructive text-destructive px-2.5 py-1.5 text-xs font-medium hover:bg-destructive/10 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── Step 2: Webhook ─── */}
        <div className={`rounded-lg border bg-card p-4 ${!step1Done ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-start gap-3">
            <StepIndicator n={2} state={step2Done ? 'done' : step1Done ? 'active' : 'pending'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">Webhook</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Register a public URL with Telegram so it can deliver messages to your bot.
                  </p>
                  {step2Done && !webhookEditing && (
                    <div className="mt-2 text-xs text-muted-foreground truncate">
                      <span className="font-mono">{status.webhookInfo.url}</span>
                      {status.webhookInfo.pendingUpdates > 0 && (
                        <span className="ml-2 text-yellow-500">
                          ({status.webhookInfo.pendingUpdates} pending)
                        </span>
                      )}
                      {status.webhookInfo.lastErrorMessage && (
                        <div className="mt-1 text-destructive">
                          Last error: {status.webhookInfo.lastErrorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {step2Done && !webhookEditing && (
                  <button
                    onClick={startWebhookEdit}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                  >
                    Change
                  </button>
                )}
              </div>

              {(!step2Done || webhookEditing) && (
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    value={webhookUrlInput}
                    onChange={(e) => {
                      if (!webhookEditing) setWebhookEditing(true);
                      setWebhookUrlInput(e.target.value);
                    }}
                    placeholder="https://example.com/api/telegram/webhook"
                    spellCheck={false}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
                  />
                  {webhookError && <div className="text-xs text-destructive">{webhookError}</div>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRegisterWebhook}
                      disabled={!step1Done || webhookSaving || !webhookUrlInput.trim()}
                      className="rounded-md bg-foreground text-background px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {webhookSaving
                        ? 'Registering...'
                        : step2Done
                          ? 'Re-register Webhook'
                          : 'Register Webhook'}
                    </button>
                    {webhookEditing && step2Done && (
                      <button
                        onClick={cancelWebhookEdit}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {status.defaultWebhookUrl &&
                      webhookUrlInput.trim() !== status.defaultWebhookUrl && (
                        <button
                          onClick={resetWebhookToDefault}
                          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline transition-colors"
                        >
                          Reset to default
                        </button>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// Backwards compat export
export function SettingsSecretsPage() {
  return <ApiKeysListPage />;
}

// ApiKeysGitHubPage removed — GitHub credentials now live on the GitHub > Tokens tab
