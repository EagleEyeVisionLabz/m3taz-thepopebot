'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { KeyIcon, CheckIcon, TrashIcon, PlusIcon } from './icons.js';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function timeAgo(ts) {
  if (!ts) return 'Never';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────────────────────────────────────

export function StatusBadge({ isSet }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${isSet ? 'text-green-500' : 'text-muted-foreground'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isSet ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
      {isSet ? 'Set' : 'Not set'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SecretRow — unified credential/secret row
// ─────────────────────────────────────────────────────────────────────────────

export function SecretRow({
  label,
  isSet,
  onSave,
  onDelete,
  onRegenerate,
  saving,
  mono,
  helpText,
  description,
  icon = true,
  inputType = 'password',
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!value) return;
    setError(null);
    const result = await onSave(value);
    if (result?.error) {
      setError(result.error);
    } else {
      setEditing(false);
      setValue('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setError(null);
    const result = await onDelete();
    if (result?.error) setError(result.error);
    setConfirmDelete(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          {icon && <KeyIcon size={14} className="text-muted-foreground shrink-0" />}
          <span className={`text-sm font-medium ${mono ? 'font-mono' : ''}`}>{label}</span>
        </div>
        {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <input
            type={inputType}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter value..."
            autoFocus
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={!value || saving}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(''); setError(null); }}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <KeyIcon size={14} className="text-muted-foreground shrink-0" />}
          <span className={`text-sm font-medium ${mono ? 'font-mono' : ''}`}>{label}</span>
          {description && <span className="text-xs text-muted-foreground hidden sm:inline">— {description}</span>}
          <StatusBadge isSet={isSet} />
        </div>
        {helpText && <p className="text-xs text-muted-foreground mt-0.5">{helpText}</p>}
        {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
        {onRegenerate && isSet && (
          <button
            onClick={onRegenerate}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Regenerate
          </button>
        )}
        <button
          onClick={() => setEditing(true)}
          className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
            saved ? 'border-green-500 text-green-500' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          {saved ? <span className="inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span> : isSet ? 'Update' : 'Set'}
        </button>
        {onDelete && isSet && (
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
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VariableRow — for GitHub variables (shows current value, text input)
// ─────────────────────────────────────────────────────────────────────────────

export function VariableRow({ name, isSet, currentValue, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setError(null);
    const result = await onDelete(name);
    if (result?.error) setError(result.error);
    setConfirmDelete(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const result = await onUpdate(name, value);
    setSaving(false);
    if (result?.success) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setError(result?.error || 'Failed to set variable');
    }
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 py-3">
        <div className="text-sm font-medium font-mono">{name}</div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter value..."
            autoFocus
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(''); setError(null); }}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium font-mono">{name}</span>
          <StatusBadge isSet={isSet} />
        </div>
        {isSet && currentValue && <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{currentValue}</p>}
        {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
        <button
          onClick={() => { setEditing(true); if (currentValue) setValue(currentValue); }}
          className={`rounded-md px-2.5 py-1.5 text-xs font-medium border transition-colors ${
            saved ? 'border-green-500 text-green-500' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          {saved ? <span className="inline-flex items-center gap-1"><CheckIcon size={12} /> Saved</span> : isSet ? 'Update' : 'Set'}
        </button>
        {isSet && (
          <button
            onClick={handleDelete}
            className={`rounded-md p-1.5 text-xs border transition-colors ${
              confirmDelete
                ? 'border-destructive text-destructive hover:bg-destructive/10'
                : 'border-border text-muted-foreground hover:text-destructive hover:border-destructive'
            }`}
            title={confirmDelete ? 'Click again to confirm' : 'Delete variable'}
          >
            <TrashIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dialog — standardized modal
// ─────────────────────────────────────────────────────────────────────────────

export function Dialog({ open, onClose, title, children, maxWidth = 'max-w-md' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={ref}
        className={`relative z-50 w-full ${maxWidth} mx-4 rounded-lg border border-border bg-background p-6 shadow-lg max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-4">{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddSecretDialog — shared manual "add a named secret" dialog
// (Name normalized to [A-Z0-9_], masked value). Used by the GitHub Secrets page
// and any other surface that needs to add a plain named secret. The Jobs page
// uses an extended variant that also supports OAuth.
// ─────────────────────────────────────────────────────────────────────────────

export function AddSecretDialog({
  open,
  onAdd,
  onCancel,
  title = 'Add Secret',
  namePlaceholder = 'MY_SECRET',
  valuePlaceholder = 'Enter value...',
}) {
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

  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium mb-1 block">Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder={namePlaceholder}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block">Value</label>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={valuePlaceholder}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={!name.trim() || !value || saving}
          className="rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState — dashed border card with optional action
// ─────────────────────────────────────────────────────────────────────────────

export function EmptyState({ message, actionLabel, onAction }) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8 flex flex-col items-center text-center">
      <p className="text-sm text-muted-foreground mb-3">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          <PlusIcon size={14} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
