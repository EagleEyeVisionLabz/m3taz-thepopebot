'use client';

import { useState, useEffect, useRef } from 'react';
import { PlusIcon } from './icons.js';
import { SecretRow, VariableRow, Dialog, AddSecretDialog } from './settings-shared.js';
import {
  getGitHubConfig,
  updateGitHubSecret,
  updateGitHubVariable,
  deleteGitHubSecretAction,
  deleteGitHubVariableAction,
  getApiKeySettings,
  updateApiKeySetting,
  regenerateWebhookSecret,
} from '../actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Add item dialogs
// ─────────────────────────────────────────────────────────────────────────────
// AddSecretDialog is the shared manual secret dialog from settings-shared.js.

function AddVariableDialog({ open, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setValue('');
      setError(null);
      setSaving(false);
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSave = async () => {
    const trimmedName = name.trim().toUpperCase();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    const result = await onAdd(trimmedName, value);
    setSaving(false);
    if (result?.success) {
      onCancel();
    } else {
      setError(result?.error || 'Failed to add variable');
    }
  };

  return (
    <Dialog open={open} onClose={onCancel} title="Add Variable">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder="e.g. MY_VARIABLE"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Value</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter value..."
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || saving}
          className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared hook for loading GitHub config
// ─────────────────────────────────────────────────────────────────────────────

function useGitHubConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const result = await getGitHubConfig();
        setData(result);
      } catch {
        setData({ error: 'Failed to load GitHub configuration' });
      } finally {
        setLoading(false);
      }
    })();
  }, [key]);

  const reload = () => setKey((k) => k + 1);

  return { data, loading, reload };
}

function NotConfigured() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <h3 className="text-sm font-medium mb-2">GitHub not configured</h3>
      <p className="text-xs text-muted-foreground">
        Set a GitHub token on the Tokens tab to enable secret and variable management.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens sub-tab — GH_TOKEN + GH_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────────────────

export function GitHubTokensPage() {
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

  const handleRegenerate = async (key) => {
    setSaving(true);
    await regenerateWebhookSecret(key);
    await loadSettings();
    setSaving(false);
  };

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-border/50" />;
  }

  return (
    <div className="space-y-6">
      {/* Personal Access Token */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-medium">Personal Access Token</h2>
          <p className="text-sm text-muted-foreground">GitHub PAT used by the event handler for repository operations (branches, PRs).</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <SecretRow
            label="Personal Access Token"
            isSet={getStatus('GH_TOKEN')}
            saving={saving}
            onSave={(val) => handleSave('GH_TOKEN', val)}
          />
        </div>
      </div>

      {/* Webhook Secret */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-medium">Webhook Secret</h2>
          <p className="text-sm text-muted-foreground">Used to verify incoming GitHub webhook signatures.</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <SecretRow
            label="Webhook Secret"
            isSet={getStatus('GH_WEBHOOK_SECRET')}
            saving={saving}
            onSave={(val) => handleSave('GH_WEBHOOK_SECRET', val)}
            onRegenerate={() => handleRegenerate('GH_WEBHOOK_SECRET')}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets sub-tab
// ─────────────────────────────────────────────────────────────────────────────

export function GitHubSecretsPage() {
  const { data, loading, reload } = useGitHubConfig();
  const [showAdd, setShowAdd] = useState(false);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (data?.error) return <NotConfigured />;

  const handleUpdate = async (name, value) => {
    const result = await updateGitHubSecret(name, value);
    if (result?.success) reload();
    return result;
  };

  const handleDelete = async (name) => {
    const result = await deleteGitHubSecretAction(name);
    if (result?.success) reload();
    return result;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">Secrets</h2>
          <p className="text-sm text-muted-foreground">Encrypted values stored on GitHub for use in GitHub Actions workflows.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
        >
          <PlusIcon size={14} />
          Add secret
        </button>
      </div>
      <AddSecretDialog
        open={showAdd}
        onAdd={handleUpdate}
        onCancel={() => setShowAdd(false)}
      />
      <div className="rounded-lg border bg-card p-4">
        <div className="divide-y divide-border">
          {data.secrets.map((s) => (
            <SecretRow
              key={s.name}
              label={s.name}
              mono
              isSet={s.isSet}
              onSave={(val) => handleUpdate(s.name, val)}
              onDelete={() => handleDelete(s.name)}
              icon={false}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variables sub-tab
// ─────────────────────────────────────────────────────────────────────────────

export function GitHubVariablesPage() {
  const { data, loading, reload } = useGitHubConfig();
  const [showAdd, setShowAdd] = useState(false);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-md bg-border/50" />;
  }

  if (data?.error) return <NotConfigured />;

  const handleUpdate = async (name, value) => {
    const result = await updateGitHubVariable(name, value);
    if (result?.success) reload();
    return result;
  };

  const handleDelete = async (name) => {
    const result = await deleteGitHubVariableAction(name);
    if (result?.success) reload();
    return result;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">Variables</h2>
          <p className="text-sm text-muted-foreground">Configuration values for agent jobs.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-colors"
        >
          <PlusIcon size={14} />
          Add variable
        </button>
      </div>
      <AddVariableDialog
        open={showAdd}
        onAdd={handleUpdate}
        onCancel={() => setShowAdd(false)}
      />
      {data.variablesError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Couldn't read GitHub variables: {data.variablesError}. Statuses below may be inaccurate. Check that the GitHub PAT has Variables: Read scope.
        </div>
      )}
      <div className="rounded-lg border bg-card p-4">
        <div className="divide-y divide-border">
          {data.variables.map((v) => (
            <VariableRow key={v.name} name={v.name} isSet={v.isSet} currentValue={v.value} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Backwards compat
export function SettingsGitHubPage() {
  return <GitHubSecretsPage />;
}
