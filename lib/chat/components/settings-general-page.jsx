'use client';

import { useState, useEffect } from 'react';
import { getGeneralSettings, updateGeneralSetting, subscribeEmailUpdates } from '../actions.js';
import { ArrowUpCircleIcon } from './icons.js';
import { UpgradeDialog } from './upgrade-dialog.js';

export function SettingsGeneralPage({ session }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [includeBeta, setIncludeBeta] = useState(false);
  const [emailAddress, setEmailAddress] = useState(session?.user?.email || '');
  const [emailSigningUp, setEmailSigningUp] = useState(false);
  const [emailSubscribed, setEmailSubscribed] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [version, setVersion] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [changelog, setChangelog] = useState(null);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  useEffect(() => {
    getGeneralSettings().then((result) => {
      if (result.settings) {
        setIncludeBeta(result.settings.UPGRADE_INCLUDE_BETA === 'true');
      }
      setLoading(false);
    });
    fetch('/admin/app-version').then(r => r.json()).then(data => {
      setVersion(data.version);
      setUpdateAvailable(data.updateAvailable);
      setChangelog(data.changelog);
    });
  }, []);

  const [showBetaConfirm, setShowBetaConfirm] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  const handleCheckForUpdates = async () => {
    setChecking(true);
    setCheckResult(null);
    const res = await fetch('/admin/app-version', { method: 'POST' });
    const data = await res.json();
    setChecking(false);
    setCheckResult(data.updateAvailable ? 'updated' : 'current');
    if (data.updateAvailable) {
      setVersion(data.version);
      setUpdateAvailable(data.updateAvailable);
      setChangelog(data.changelog);
    } else {
      setUpdateAvailable(null);
    }
    setTimeout(() => setCheckResult(null), 3000);
  };

  const handleToggle = async () => {
    if (!includeBeta) {
      setShowBetaConfirm(true);
      return;
    }
    setIncludeBeta(false);
    setSaving(true);
    await updateGeneralSetting('UPGRADE_INCLUDE_BETA', 'false');
    setSaving(false);
  };

  const confirmBeta = async () => {
    setShowBetaConfirm(false);
    setIncludeBeta(true);
    setSaving(true);
    await updateGeneralSetting('UPGRADE_INCLUDE_BETA', 'true');
    setSaving(false);
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
    <div className="space-y-6">
      {/* Auto Upgrade */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-medium">Auto Upgrade</h2>
          <p className="text-sm text-muted-foreground">
          Configure how the system checks for new versions.
          </p>
        </div>

        {updateAvailable && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-3 mb-3">
              <ArrowUpCircleIcon size={20} className="text-emerald-500 shrink-0" />
              <p className="text-sm font-medium">
                Version <span className="font-mono text-emerald-500">v{updateAvailable}</span> is available
              </p>
            </div>
            <button
              onClick={() => setShowUpgradeDialog(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            >
              <ArrowUpCircleIcon size={16} />
              Upgrade to v{updateAvailable}
            </button>
          </div>
        )}

        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCheckForUpdates}
              disabled={checking}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {checking ? 'Checking...' : 'Check for Updates'}
            </button>
            {checkResult === 'updated' && (
              <span className="text-sm text-green-500">Update found</span>
            )}
            {checkResult === 'current' && (
              <span className="text-sm text-muted-foreground">Already up to date</span>
            )}
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeBeta}
              onChange={handleToggle}
              disabled={saving}
              className="mt-1 h-4 w-4 rounded border-border accent-foreground"
            />
            <div>
              <span className="text-sm font-medium">Include beta versions</span>
              <p className="text-sm text-muted-foreground mt-0.5">
                Stable installs only check for stable releases by default. Enable this to also check the beta channel for pre-release updates.
              </p>
            </div>
          </label>
        </div>

        {showBetaConfirm && (
          <div className="mt-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
            <p className="text-sm font-medium text-yellow-500 mb-1">
              Are you sure?
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              Beta releases may contain breaking changes that could require manual recovery, including SSH access to your server, restoring backups, or re-running setup. Only enable this if you're comfortable troubleshooting issues.
            </p>
            <div className="flex gap-2">
              <button
                onClick={confirmBeta}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 transition-colors"
              >
                {saving ? 'Saving...' : 'Enable beta releases'}
              </button>
              <button
                onClick={() => setShowBetaConfirm(false)}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Email Updates */}
      <div>
        <div className="mb-4">
          <h2 className="text-base font-medium">Email Updates</h2>
          <p className="text-sm text-muted-foreground">
            Get urgent updates and features.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Email</label>
            <input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </div>

          {emailSubscribed ? (
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <p className="text-sm font-medium text-green-500">Subscribed</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const trimmedEmail = emailAddress.trim();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
                      setEmailError('Enter a valid email address.');
                      return;
                    }
                    setEmailError(null);
                    setEmailSigningUp(true);
                    const result = await subscribeEmailUpdates(trimmedEmail);
                    setEmailSigningUp(false);
                    if (result?.success) {
                      setEmailSubscribed(true);
                    } else {
                      setEmailError(result?.error || 'Signup failed. Please try again.');
                    }
                  }}
                  disabled={emailSigningUp}
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                >
                  {emailSigningUp ? 'Signing up...' : 'Sign Up'}
                </button>
              </div>
              {emailError && (
                <p className="text-sm text-destructive">{emailError}</p>
              )}
            </div>
          )}
        </div>
      </div>
      <UpgradeDialog
        open={showUpgradeDialog}
        onClose={() => setShowUpgradeDialog(false)}
        version={version}
        updateAvailable={updateAvailable}
        changelog={changelog}
      />
    </div>
  );
}
