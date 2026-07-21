import React, { useEffect, useMemo, useState } from 'react';
import type { AppLanguage, StorageInfo, UiTheme } from '../types';
import { DiagnosticsTab } from './DiagnosticsTab';
import {
  DEFAULT_QUALITY_MAPPINGS,
  findDuplicateQualityKeywords,
  normalizeQualityMappings,
  validateSourceUrl
} from '../services/settingsValidation';

export interface SettingsSavePayload {
  playlistUrl: string;
  epgUrl: string;
  qualityMappings: Record<string, string>;
  autoRefreshHours: number;
  autoplayLastChannel: boolean;
  historyRetentionDays: number;
  discordRpcEnabled: boolean;
  discordShowChannel: boolean;
  discordShowProgram: boolean;
  discordShowArtwork: boolean;
  discordClientId: string;
  appearance: UiTheme;
  language: AppLanguage;
  recordingDirectory: string;
}

interface SettingsTabProps {
  initialPlaylistUrl: string;
  initialEpgUrl: string;
  initialQualityMappings: Record<string, string>;
  initialAutoRefreshHours: number;
  initialAutoplayLastChannel: boolean;
  initialHistoryRetentionDays: number;
  initialDiscordRpcEnabled: boolean;
  initialDiscordShowChannel: boolean;
  initialDiscordShowProgram: boolean;
  initialDiscordShowArtwork: boolean;
  initialDiscordClientId: string;
  initialAppearance: UiTheme;
  initialLanguage: AppLanguage;
  initialRecordingDirectory: string;
  cacheStatus: string;
  guideStatus: string;
  statusText: string;
  isLoading: boolean;
  storageInfo: StorageInfo | null;
  favoritesCount: number;
  recentCount: number;
  onSave: (payload: SettingsSavePayload) => Promise<void>;
  onSaveAndRefresh: (payload: SettingsSavePayload) => Promise<void>;
  onTestSources: (playlistUrl: string, epgUrl: string) => Promise<string>;
  onClearCache: () => Promise<void>;
  onClearHistory: () => Promise<void>;
  onClearFavorites: () => Promise<void>;
  onClearRecents: () => Promise<void>;
  onImportBackup: (password: string) => Promise<boolean>;
  onDirtyChange?: (isDirty: boolean) => void;
}

const QUALITY_MAPPING_ORDER = ['4K', 'FHD', 'HEVC', 'HD', 'SD', 'Low', 'Backup'];

export const SettingsTab: React.FC<SettingsTabProps> = (props) => {
  const {
    initialPlaylistUrl, initialEpgUrl, initialQualityMappings, initialAutoRefreshHours,
    initialAutoplayLastChannel, initialHistoryRetentionDays,
    initialDiscordRpcEnabled, initialDiscordShowChannel, initialDiscordShowProgram, initialDiscordShowArtwork, initialDiscordClientId,
    initialAppearance, initialLanguage, initialRecordingDirectory, cacheStatus, guideStatus, statusText,
    isLoading, storageInfo, favoritesCount, recentCount, onSave, onSaveAndRefresh,
    onTestSources, onClearCache, onClearHistory, onClearFavorites, onClearRecents,
    onImportBackup, onDirtyChange
  } = props;
  const [playlistUrl, setPlaylistUrl] = useState(initialPlaylistUrl);
  const [epgUrl, setEpgUrl] = useState(initialEpgUrl);
  const [showPlaylistUrl, setShowPlaylistUrl] = useState(false);
  const [showEpgUrl, setShowEpgUrl] = useState(false);
  const [qualityMappings, setQualityMappings] = useState(initialQualityMappings);
  const [autoRefreshHours, setAutoRefreshHours] = useState(initialAutoRefreshHours);
  const [autoplayLastChannel, setAutoplayLastChannel] = useState(initialAutoplayLastChannel);
  const [historyRetentionDays, setHistoryRetentionDays] = useState(initialHistoryRetentionDays);
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(initialDiscordRpcEnabled);
  const [discordShowChannel, setDiscordShowChannel] = useState(initialDiscordShowChannel);
  const [discordShowProgram, setDiscordShowProgram] = useState(initialDiscordShowProgram);
  const [discordShowArtwork, setDiscordShowArtwork] = useState(initialDiscordShowArtwork);
  const [appearance, setAppearance] = useState<UiTheme>(initialAppearance);
  const [language, setLanguage] = useState<AppLanguage>(initialLanguage);
  const [recordingDirectory, setRecordingDirectory] = useState(initialRecordingDirectory);
  const [exportPassword, setExportPassword] = useState('');
  const [exportPasswordConfirmation, setExportPasswordConfirmation] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const normalizedMappings = useMemo(() => normalizeQualityMappings(qualityMappings), [qualityMappings]);
  const duplicateQualityKeywords = useMemo(() => findDuplicateQualityKeywords(normalizedMappings), [normalizedMappings]);
  const playlistError = validateSourceUrl(playlistUrl, true);
  const epgError = validateSourceUrl(epgUrl, false);
  const hasValidationErrors = Boolean(playlistError || epgError || duplicateQualityKeywords.length > 0);
  const isBusy = isLoading || isSaving || isTesting;
  const footerMessage = message || (isDirty ? 'You have unsaved changes.' : 'All changes are saved.');

  useEffect(() => {
    onDirtyChange?.(isDirty);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      onDirtyChange?.(false);
    };
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = appearance === 'system' ? (isDark ? 'dark' : 'light') : appearance;
  }, [appearance]);

  const markDirty = () => setIsDirty(true);
  const change = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value);
    markDirty();
  };

  const buildPayload = (): SettingsSavePayload => ({
    playlistUrl: playlistUrl.trim(),
    epgUrl: epgUrl.trim(),
    qualityMappings: normalizedMappings,
    autoRefreshHours: Math.max(0, Math.min(168, Math.round(Number(autoRefreshHours) || 0))),
    autoplayLastChannel,
    historyRetentionDays: Math.max(0, Math.min(3650, Math.round(Number(historyRetentionDays) || 0))),
    discordRpcEnabled,
    discordShowChannel,
    discordShowProgram,
    discordShowArtwork,
    discordClientId: initialDiscordClientId.trim(),
    appearance,
    language,
    recordingDirectory
  });

  const save = async (syncAfterSave: boolean) => {
    if (hasValidationErrors) return setMessage('Fix the highlighted fields before continuing.');
    setIsSaving(true);
    setMessage('');
    try {
      const payload = buildPayload();
      await (syncAfterSave ? onSaveAndRefresh(payload) : onSave(payload));
      setMessage(syncAfterSave ? 'Settings saved and sources synchronized.' : 'Settings saved.');
      setIsDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const discard = () => {
    setPlaylistUrl(initialPlaylistUrl);
    setEpgUrl(initialEpgUrl);
    setQualityMappings(initialQualityMappings);
    setAutoRefreshHours(initialAutoRefreshHours);
    setAutoplayLastChannel(initialAutoplayLastChannel);
    setHistoryRetentionDays(initialHistoryRetentionDays);
    setDiscordRpcEnabled(initialDiscordRpcEnabled);
    setDiscordShowChannel(initialDiscordShowChannel);
    setDiscordShowProgram(initialDiscordShowProgram);
    setDiscordShowArtwork(initialDiscordShowArtwork);
    setAppearance(initialAppearance);
    setLanguage(initialLanguage);
    setRecordingDirectory(initialRecordingDirectory);
    setShowPlaylistUrl(false);
    setShowEpgUrl(false);
    setExportPassword('');
    setExportPasswordConfirmation('');
    setImportPassword('');
    setMessage('Changes discarded.');
    setIsDirty(false);
    onDirtyChange?.(false);
  };

  const testSources = async () => {
    if (playlistError || epgError) return setMessage('Fix the source URLs before testing.');
    setIsTesting(true);
    setMessage('');
    try { setMessage(await onTestSources(playlistUrl.trim(), epgUrl.trim())); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Source test failed.'); }
    finally { setIsTesting(false); }
  };

  const chooseRecordingDirectory = async () => {
    const selected = await window.electron.selectRecordingDirectory();
    if (selected) change(setRecordingDirectory, selected);
  };

  const runDestructiveAction = async (label: string, action: () => Promise<void>, successMessage: string) => {
    if (!window.confirm(`${label}? This action cannot be undone.`)) return;
    setIsSaving(true);
    setMessage('');
    try { await action(); setMessage(successMessage); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Action failed.'); }
    finally { setIsSaving(false); }
  };

  const exportBackup = async () => {
    if (exportPassword.length < 10) return setMessage('Backup password must contain at least 10 characters.');
    if (exportPassword !== exportPasswordConfirmation) return setMessage('Backup password confirmation does not match.');
    setIsSaving(true);
    try {
      const result = await window.electron.exportBackup(exportPassword);
      if (!result.ok && !result.canceled) throw new Error(result.error || 'Backup export failed.');
      if (result.ok) setMessage(`Backup exported to ${result.path}.`);
      setExportPassword('');
      setExportPasswordConfirmation('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Backup export failed.'); }
    finally { setIsSaving(false); }
  };

  const importBackup = async () => {
    if (importPassword.length < 10) return setMessage('Backup password must contain at least 10 characters.');
    if (isDirty && !window.confirm('Discard unsaved settings changes and import this backup?')) return;
    setIsSaving(true);
    try {
      if (await onImportBackup(importPassword)) {
        setMessage('Backup imported. Sources are being synchronized.');
        setImportPassword('');
        setIsDirty(false);
        onDirtyChange?.(false);
        window.location.reload();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Backup import failed.'); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="animate-fade settings-page settings-page--linear">
      <header className="page-header settings-header">
        <div><p className="page-eyebrow">Freaky IPTV</p><h2>Settings</h2><p>Configure the app from top to bottom. Advanced details stay out of the way.</p></div>
      </header>

      <SettingsSection id="sources" title="Sources" description="Connect your channel list and optional programme guide.">
        <SecretUrlField id="settings-playlist-url" label="M3U playlist URL" value={playlistUrl} visible={showPlaylistUrl} error={playlistError} disabled={isBusy} placeholder="https://example.com/playlist.m3u" onVisibility={setShowPlaylistUrl} onChange={(value) => change(setPlaylistUrl, value)} />
        <SecretUrlField id="settings-epg-url" label="XMLTV EPG URL (optional)" value={epgUrl} visible={showEpgUrl} error={epgError} disabled={isBusy} placeholder="https://example.com/epg.xml" onVisibility={setShowEpgUrl} onChange={(value) => change(setEpgUrl, value)} />
        <div className="settings-inline-fields">
          <NumberField label="Refresh sources every (hours)" hint="Use 0 to disable automatic refresh." value={autoRefreshHours} min={0} max={168} disabled={isBusy} onChange={(value) => change(setAutoRefreshHours, value)} />
        </div>
        <div className="settings-source-actions">
          <button type="button" className="btn-secondary" onClick={testSources} disabled={isBusy || Boolean(playlistError || epgError)}>{isTesting ? 'Testing…' : 'Test connection'}</button>
          <button type="button" className="btn-secondary" onClick={() => void save(true)} disabled={isBusy || hasValidationErrors}>{isSaving ? 'Synchronizing…' : 'Synchronize now'}</button>
        </div>
      </SettingsSection>

      <SettingsSection id="playback" title="Playback" description="Choose what happens when the application starts.">
        <label className="settings-switch-row"><input type="checkbox" checked={autoplayLastChannel} onChange={(event) => change(setAutoplayLastChannel, event.target.checked)} disabled={isBusy} /><span><strong>Play the last channel automatically</strong><small>Resume the most recently watched channel after startup.</small></span></label>
      </SettingsSection>

      <SettingsSection id="recordings" title="Recordings" description="Recordings and screenshots use the same destination. Video is saved as source-quality MKV.">
        <label className="settings-field"><span>Output folder</span><div className="settings-path-row"><input className="text-input" value={recordingDirectory} readOnly aria-label="Recording output folder" /><button type="button" className="btn-secondary" onClick={chooseRecordingDirectory} disabled={isBusy}>Choose</button><button type="button" className="btn-secondary" onClick={() => void window.electron.openRecordingDirectory()} disabled={isBusy}>Open</button></div></label>
        <p className="settings-inline-note"><strong>MKV · original quality</strong><span>The app records a separate copy of the source stream.</span></p>
      </SettingsSection>

      <SettingsSection id="appearance" title="Appearance" description="Changes are previewed immediately. Discard restores the saved theme.">
        <div className="segmented-control appearance-segmented" role="radiogroup" aria-label="Application appearance">
          {(['system', 'light', 'dark'] as const).map(option => <button key={option} type="button" role="radio" aria-checked={appearance === option} className={appearance === option ? 'is-selected' : ''} onClick={() => change(setAppearance, option)} disabled={isBusy}>{option === 'system' ? 'Use system setting' : option === 'light' ? 'Light' : 'Dark'}</button>)}
        </div>
        <label className="settings-field"><span>Language</span><select className="text-input" value={language} onChange={(event) => change(setLanguage, event.target.value as AppLanguage)} disabled={isBusy} aria-label="Application language"><option value="system">Use system language</option><option value="pt-PT">Portuguese (Portugal)</option><option value="en">English</option></select></label>
      </SettingsSection>

      <SettingsSection id="integrations" title="Integrations" description="Control what Freaky IPTV shares with connected applications.">
        <label className="settings-switch-row"><input type="checkbox" checked={discordRpcEnabled} onChange={(event) => change(setDiscordRpcEnabled, event.target.checked)} disabled={isBusy} /><span><strong>Discord Rich Presence</strong><small>Show that Freaky IPTV is active on your Discord profile.</small></span></label>
        <label className="settings-switch-row" data-disabled={!discordRpcEnabled}><input type="checkbox" checked={discordShowChannel} onChange={(event) => change(setDiscordShowChannel, event.target.checked)} disabled={isBusy || !discordRpcEnabled} /><span><strong>Include the channel name</strong><small>Only enabled while Discord Rich Presence is active.</small></span></label>
        <label className="settings-switch-row" data-disabled={!discordRpcEnabled}><input type="checkbox" checked={discordShowProgram} onChange={(event) => change(setDiscordShowProgram, event.target.checked)} disabled={isBusy || !discordRpcEnabled} /><span><strong>Include programme title</strong><small>Off by default to keep viewing private.</small></span></label>
        <label className="settings-switch-row" data-disabled={!discordRpcEnabled}><input type="checkbox" checked={discordShowArtwork} onChange={(event) => change(setDiscordShowArtwork, event.target.checked)} disabled={isBusy || !discordRpcEnabled} /><span><strong>Include channel artwork</strong><small>Artwork is sent through the external images.weserv.nl proxy.</small></span></label>
      </SettingsSection>

      <SettingsSection id="data" title="Data & privacy" description="Choose how long local activity is retained, create encrypted backups, or remove data.">
        <div className="settings-inline-fields"><NumberField label="Keep viewing history for (days)" hint="Use 0 to keep history indefinitely." value={historyRetentionDays} min={0} max={3650} disabled={isBusy} onChange={(value) => change(setHistoryRetentionDays, value)} /></div>
        <div className="settings-backup-fields">
          <div className="settings-subheading"><strong>Encrypted backup</strong><span>Passwords must contain at least 10 characters.</span></div>
          <input type="password" className="text-input" placeholder="Export password" value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} autoComplete="new-password" />
          <input type="password" className="text-input" placeholder="Confirm export password" value={exportPasswordConfirmation} onChange={(event) => setExportPasswordConfirmation(event.target.value)} autoComplete="new-password" />
          <button type="button" className="btn-secondary" disabled={isBusy} onClick={exportBackup}>Export encrypted backup</button>
          <input type="password" className="text-input" placeholder="Password for imported backup" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} autoComplete="current-password" />
          <button type="button" className="btn-secondary" disabled={isBusy} onClick={importBackup}>Import and merge backup</button>
        </div>
        <div className="settings-data-actions">
          <button className="btn-secondary" type="button" disabled={isBusy} onClick={() => void runDestructiveAction('Clear the cached channel list and guide', onClearCache, 'Cache cleared.')}>Clear cache</button>
          <button className="btn-secondary" type="button" disabled={isBusy} onClick={() => void runDestructiveAction('Clear all viewing history', onClearHistory, 'History cleared.')}>Clear history</button>
          <button className="btn-secondary" type="button" disabled={isBusy || favoritesCount === 0} onClick={() => void runDestructiveAction(`Clear ${favoritesCount} favorites`, onClearFavorites, 'Favorites cleared.')}>Clear favorites ({favoritesCount})</button>
          <button className="btn-secondary" type="button" disabled={isBusy || recentCount === 0} onClick={() => void runDestructiveAction(`Clear ${recentCount} recent channels`, onClearRecents, 'Recent channels cleared.')}>Clear recents ({recentCount})</button>
        </div>
      </SettingsSection>

      <SettingsSection id="diagnostics" title="Diagnostics" description="Inspect local health and export a redacted support report.">
        <DiagnosticsTab embedded />
      </SettingsSection>

      <details className="settings-advanced">
        <summary><span><strong>Advanced</strong><small>Diagnostics and quality detection labels</small></span><span aria-hidden="true">⌄</span></summary>
        <div className="settings-advanced-content">
          <div className="settings-status-grid">
            <StatusRow label="Playlist cache" value={cacheStatus || 'No cache loaded'} /><StatusRow label="TV guide cache" value={guideStatus || 'No guide loaded'} /><StatusRow label="Operation" value={statusText} strong={isLoading} /><StatusRow label="Data folder" value={storageInfo?.dataDir || 'Unavailable'} /><StatusRow label="Migration" value={storageInfo?.migrationStatus ? `${storageInfo.migrationStatus.status}${storageInfo.migrationStatus.copied.length ? ` (${storageInfo.migrationStatus.copied.length} files copied)` : ''}` : 'Unavailable'} /><StatusRow label="Cache size" value={formatBytes(storageInfo?.cacheBytes || 0)} /><StatusRow label="History size" value={formatBytes(storageInfo?.historyBytes || 0)} /><StatusRow label="Last update" value={formatDate(storageInfo?.cacheUpdatedAtUtc)} />
          </div>
          <div className="settings-quality-header"><span>Quality detection labels</span>{duplicateQualityKeywords.length > 0 && <span role="alert">Duplicate keywords: {duplicateQualityKeywords.join(', ')}</span>}<button type="button" className="btn-secondary" onClick={() => { setQualityMappings(DEFAULT_QUALITY_MAPPINGS); markDirty(); }} disabled={isBusy}>Reset defaults</button></div>
          <div className="settings-quality-grid">{QUALITY_MAPPING_ORDER.map(label => <label key={label} htmlFor={`quality-mapping-${label}`}><span>{label}</span><input id={`quality-mapping-${label}`} type="text" className="text-input" value={qualityMappings[label] || ''} onChange={(event) => { setQualityMappings(previous => ({ ...previous, [label]: event.target.value })); markDirty(); }} placeholder="Comma-separated keywords" disabled={isBusy} /></label>)}</div>
        </div>
      </details>

      <div className="settings-save-bar" aria-live="polite">
        <span className={hasValidationErrors ? 'is-error' : ''}>{footerMessage}</span>
        <div><button type="button" className="btn-secondary" onClick={discard} disabled={isBusy || !isDirty}>Discard</button><button type="button" className="btn-primary" onClick={() => void save(false)} disabled={isBusy || !isDirty || hasValidationErrors}>{isSaving ? 'Saving…' : 'Save changes'}</button></div>
      </div>
    </div>
  );
};

const SettingsSection: React.FC<React.PropsWithChildren<{ id: string; title: string; description: string }>> = ({ id, title, description, children }) => <section className="settings-group" aria-labelledby={`${id}-heading`}><div className="settings-group-heading"><h3 id={`${id}-heading`}>{title}</h3><p>{description}</p></div>{children}</section>;

const SecretUrlField: React.FC<{ id: string; label: string; value: string; visible: boolean; error: string | null; disabled: boolean; placeholder: string; onVisibility: (visible: boolean) => void; onChange: (value: string) => void }> = ({ id, label, value, visible, error, disabled, placeholder, onVisibility, onChange }) => <label className="settings-field" htmlFor={id}><span>{label}{error && <em id={`${id}-error`}>{error}</em>}</span><div className="settings-secret-field"><input id={id} type={visible ? 'url' : 'password'} className="text-input" value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => onVisibility(false)} placeholder={placeholder} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} spellCheck={false} autoComplete="off" /><button type="button" className="btn-secondary" aria-controls={id} aria-pressed={visible} onMouseDown={(event) => event.preventDefault()} onClick={() => onVisibility(!visible)} disabled={disabled}>{visible ? 'Hide' : 'Show'}</button></div></label>;

const NumberField: React.FC<{ label: string; hint: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }> = ({ label, hint, value, min, max, disabled, onChange }) => <label className="settings-field"><span>{label}<small>{hint}</small></span><input type="number" className="text-input" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} /></label>;

const StatusRow: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => <div><span>{label}</span><strong className={strong ? 'is-active' : ''}>{value}</strong></div>;

function formatBytes(bytes: number): string { if (!bytes) return '0 KB'; const mb = bytes / (1024 * 1024); return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function formatDate(value?: string): string { if (!value) return 'Never'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString(); }
