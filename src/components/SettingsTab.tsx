import { useI18n } from '../hooks/useI18n';
import React, { useEffect, useMemo, useState } from 'react';
import type { AppLanguage, StorageInfo, UiTheme } from '../types';
import { DiagnosticsTab } from './DiagnosticsTab';
import { NumberField, SettingsSection, StatusRow } from './settings/SettingsFields';
import '../settings.css';
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
  const { t } = useI18n();
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
  const [category, setCategory] = useState('sources');
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const normalizedMappings = useMemo(() => normalizeQualityMappings(qualityMappings), [qualityMappings]);
  const duplicateQualityKeywords = useMemo(() => findDuplicateQualityKeywords(normalizedMappings), [normalizedMappings]);
  const playlistError = validateSourceUrl(playlistUrl, false);
  const epgError = validateSourceUrl(epgUrl, false);
  const hasValidationErrors = Boolean(playlistError || epgError || duplicateQualityKeywords.length > 0);
  const isBusy = isLoading || isSaving || isTesting;
  const footerMessage = t(message || (isDirty ? 'You have unsaved changes.' : ''));

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
    if (!window.confirm(t('{action}? This action cannot be undone.', { action: t(label) }))) return;
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
    if (isDirty && !window.confirm(t('Discard unsaved settings changes and import this backup?'))) return;
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
    <div className="animate-fade settings-page settings-page--grouped">
      <header className="page-header settings-header">
        <div><h2>{t("Settings")}</h2></div>
      </header>

      <div className="settings-workspace">
        <nav className="settings-category-nav" aria-label={t("Settings categories")}>
          {(['sources', 'playback', 'appearance', 'privacy', 'advanced'] as const).map(item => <button type="button" key={item} className={category === item ? 'is-selected' : ''} aria-current={category === item ? 'page' : undefined} onClick={() => setCategory(item)}><strong>{t(item[0].toUpperCase() + item.slice(1))}</strong></button>)}
        </nav>
        <div className="settings-category-panel" key={category}>
      {category === 'sources' && <SettingsSection id="sources" title={t("Sources")}>
        <SecretUrlField id="settings-playlist-url" label={t("M3U playlist URL")} value={playlistUrl} visible={showPlaylistUrl} error={playlistError} disabled={isBusy} placeholder={t("https://example.com/playlist.m3u")} onVisibility={setShowPlaylistUrl} onChange={(value) => change(setPlaylistUrl, value)} />
        <SecretUrlField id="settings-epg-url" label={t("XMLTV EPG URL (optional)")} value={epgUrl} visible={showEpgUrl} error={epgError} disabled={isBusy} placeholder={t("https://example.com/epg.xml")} onVisibility={setShowEpgUrl} onChange={(value) => change(setEpgUrl, value)} />
        <div className="settings-inline-fields">
          <NumberField zeroLabel={t("Off")} enabledValue={24} label={t("Refresh sources every (hours)")} value={autoRefreshHours} min={0} max={168} disabled={isBusy} onChange={(value) => change(setAutoRefreshHours, value)} />
        </div>
        <div className="settings-source-actions">
          <button type="button" className="btn-secondary" onClick={testSources} disabled={isBusy || !playlistUrl.trim() || Boolean(playlistError || epgError)}>{t(isTesting ? 'Testing…' : 'Test connection')}</button>
          <button type="button" className="btn-secondary" onClick={() => void save(true)} disabled={isBusy || !playlistUrl.trim() || hasValidationErrors}>{t(isSaving ? 'Synchronizing…' : 'Synchronize now')}</button>
        </div>
      </SettingsSection>}

      {category === 'playback' && <SettingsSection id="playback" title={t("Playback")}>
        <label className="settings-switch-row"><input type="checkbox" checked={autoplayLastChannel} onChange={(event) => change(setAutoplayLastChannel, event.target.checked)} disabled={isBusy} /><span><strong>{t("Play the last channel automatically")}</strong></span></label>
      </SettingsSection>}

      {category === 'playback' && <SettingsSection id="recordings" title={t("Recordings")}>
        <label className="settings-field"><span>{t("Output folder")}</span><div className="settings-path-row"><input className="text-input" value={recordingDirectory} readOnly aria-label={t("Recording output folder")} /><button type="button" className="btn-secondary" onClick={chooseRecordingDirectory} disabled={isBusy}>{t("Choose")}</button><button type="button" className="btn-secondary" onClick={() => void window.electron.openRecordingDirectory()} disabled={isBusy}>{t("Open")}</button></div></label>

      </SettingsSection>}

      {category === 'appearance' && <SettingsSection id="appearance" title={t("Appearance")}>
        <div className="segmented-control appearance-segmented" role="radiogroup" aria-label={t("Application appearance")}>
          {(['system', 'light', 'dark'] as const).map(option => <button key={option} type="button" role="radio" aria-checked={appearance === option} className={appearance === option ? 'is-selected' : ''} onClick={() => change(setAppearance, option)} disabled={isBusy}>{t(option === 'system' ? 'Use system setting' : option === 'light' ? 'Light' : 'Dark')}</button>)}
        </div>
        <label className="settings-field"><span>{t("Language")}</span><select className="text-input" value={language} onChange={(event) => change(setLanguage, event.target.value as AppLanguage)} disabled={isBusy} aria-label={t("Application language")}><option value="system">{t("Use system language")}</option><option value="pt-PT">{t("Portuguese (Portugal)")}</option><option value="en">{t("English")}</option></select></label>
      </SettingsSection>}

      {category === 'privacy' && <SettingsSection id="integrations" title={t("Integrations")}>
        <label className="settings-switch-row"><input type="checkbox" checked={discordRpcEnabled} onChange={(event) => change(setDiscordRpcEnabled, event.target.checked)} disabled={isBusy} /><span><strong>{t("Discord Rich Presence")}</strong></span></label>
        <label className="settings-switch-row" data-disabled={!discordRpcEnabled}><input type="checkbox" checked={discordShowChannel} onChange={(event) => change(setDiscordShowChannel, event.target.checked)} disabled={isBusy || !discordRpcEnabled} /><span><strong>{t("Include the channel name")}</strong></span></label>
        <label className="settings-switch-row" data-disabled={!discordRpcEnabled}><input type="checkbox" checked={discordShowProgram} onChange={(event) => change(setDiscordShowProgram, event.target.checked)} disabled={isBusy || !discordRpcEnabled} /><span><strong>{t("Include programme title")}</strong></span></label>
        <label className="settings-switch-row" data-disabled={!discordRpcEnabled}><input type="checkbox" checked={discordShowArtwork} onChange={(event) => change(setDiscordShowArtwork, event.target.checked)} disabled={isBusy || !discordRpcEnabled} /><span><strong>{t("Include channel artwork")}</strong></span></label>
      </SettingsSection>}

      {category === 'privacy' && <SettingsSection id="data" title={t("Data & privacy")}>
        <div className="settings-inline-fields"><NumberField zeroLabel={t("Keep forever")} enabledValue={30} label={t("Keep viewing history for (days)")} value={historyRetentionDays} min={0} max={3650} disabled={isBusy} onChange={(value) => change(setHistoryRetentionDays, value)} /></div>
        <div className="settings-backup-fields">
          <div className="settings-subheading"><strong>{t("Encrypted backup")}</strong></div>
          <input type="password" className="text-input" placeholder={t("Export password (10+ characters)")} aria-label={t("Export password")} minLength={10} value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} autoComplete="new-password" />
          <input type="password" className="text-input" placeholder={t("Confirm export password")} aria-label={t("Confirm export password")} value={exportPasswordConfirmation} onChange={(event) => setExportPasswordConfirmation(event.target.value)} autoComplete="new-password" />
          <button type="button" className="btn-secondary" disabled={isBusy} onClick={exportBackup}>{t("Export encrypted backup")}</button>
          <input type="password" className="text-input" placeholder={t("Password for imported backup")} aria-label={t("Password for imported backup")} value={importPassword} onChange={(event) => setImportPassword(event.target.value)} autoComplete="current-password" />
          <button type="button" className="btn-secondary" disabled={isBusy} onClick={importBackup}>{t("Import and merge backup")}</button>
        </div>
        <div className="settings-data-actions">
          <button className="btn-secondary" type="button" disabled={isBusy} onClick={() => void runDestructiveAction('Clear the cached channel list and guide', onClearCache, 'Cache cleared.')}>{t("Clear cache")}</button>
          <button className="btn-secondary" type="button" disabled={isBusy} onClick={() => void runDestructiveAction('Clear all viewing history', onClearHistory, 'History cleared.')}>{t("Clear history")}</button>
          <button className="btn-secondary" type="button" disabled={isBusy || favoritesCount === 0} onClick={() => void runDestructiveAction(`Clear ${favoritesCount} favorites`, onClearFavorites, 'Favorites cleared.')}>{t('Clear favorites ({count})', { count: favoritesCount })}</button>
          <button className="btn-secondary" type="button" disabled={isBusy || recentCount === 0} onClick={() => void runDestructiveAction(`Clear ${recentCount} recent channels`, onClearRecents, 'Recent channels cleared.')}>{t('Clear recents ({count})', { count: recentCount })}</button>
        </div>
      </SettingsSection>}

      {category === 'advanced' && <SettingsSection id="diagnostics" title={t("Diagnostics")}>
        <DiagnosticsTab embedded />
      </SettingsSection>}

      {category === 'advanced' && <section className="settings-group settings-advanced">
        <h3>{t('Local storage & quality')}</h3>
        <div className="settings-advanced-content">
          <div className="settings-status-grid">
            <StatusRow label={t("Playlist cache")} value={cacheStatus || 'No cache loaded'} /><StatusRow label={t("TV guide cache")} value={guideStatus || 'No guide loaded'} /><StatusRow label={t("Operation")} value={t(statusText)} strong={isLoading} /><StatusRow label={t("Data folder")} value={storageInfo?.dataDir || 'Unavailable'} /><StatusRow label={t("Migration")} value={storageInfo?.migrationStatus ? `${storageInfo.migrationStatus.status}${storageInfo.migrationStatus.copied.length ? ` (${storageInfo.migrationStatus.copied.length} files copied)` : ''}` : 'Unavailable'} /><StatusRow label={t("Cache size")} value={formatBytes(storageInfo?.cacheBytes || 0)} /><StatusRow label={t("History size")} value={formatBytes(storageInfo?.historyBytes || 0)} /><StatusRow label={t("Last update")} value={formatDate(storageInfo?.cacheUpdatedAtUtc)} />
          </div>
          <div className="settings-quality-header"><span>{t("Quality detection labels")}</span>{duplicateQualityKeywords.length > 0 && <span role="alert">{t("Duplicate keywords:")} {duplicateQualityKeywords.join(', ')}</span>}<button type="button" className="btn-secondary" onClick={() => { setQualityMappings(DEFAULT_QUALITY_MAPPINGS); markDirty(); }} disabled={isBusy}>{t("Reset defaults")}</button></div>
          <div className="settings-quality-grid">{QUALITY_MAPPING_ORDER.map(label => <label key={label} htmlFor={`quality-mapping-${label}`}><span>{label}</span><input id={`quality-mapping-${label}`} type="text" className="text-input" value={qualityMappings[label] || ''} onChange={(event) => { setQualityMappings(previous => ({ ...previous, [label]: event.target.value })); markDirty(); }} placeholder={t("Comma-separated keywords")} disabled={isBusy} /></label>)}</div>
        </div>
      </section>}

        </div>
      </div>
      <div className="settings-save-bar" aria-live="polite">
        <span className={hasValidationErrors ? 'is-error' : ''}>{footerMessage}</span>
        <div><button type="button" className="btn-secondary" onClick={discard} disabled={isBusy || !isDirty}>{t("Discard")}</button><button type="button" className="btn-primary" onClick={() => void save(false)} disabled={isBusy || !isDirty || hasValidationErrors}>{t(isSaving ? 'Saving…' : 'Save changes')}</button></div>
      </div>
    </div>
  );
};


const SecretUrlField: React.FC<{ id: string; label: string; value: string; visible: boolean; error: string | null; disabled: boolean; placeholder: string; onVisibility: (visible: boolean) => void; onChange: (value: string) => void }> = ({ id, label, value, visible, error, disabled, placeholder, onVisibility, onChange }) => { const { t } = useI18n(); return <label className="settings-field" htmlFor={id}><span>{label}{error && <em id={`${id}-error`}>{t(error)}</em>}</span><div className="settings-secret-field"><input id={id} type={visible ? 'url' : 'password'} className="text-input" value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => onVisibility(false)} placeholder={placeholder} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} spellCheck={false} autoComplete="off" /><button type="button" className="btn-secondary" aria-controls={id} aria-pressed={visible} onMouseDown={(event) => event.preventDefault()} onClick={() => onVisibility(!visible)} disabled={disabled}>{t(visible ? 'Hide' : 'Show')}</button></div></label>; };



function formatBytes(bytes: number): string { if (!bytes) return '0 KB'; const mb = bytes / (1024 * 1024); return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; }
function formatDate(value?: string): string { if (!value) return 'Never'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString(); }
