import { useI18n } from '../hooks/useI18n';
import React, { useEffect, useRef, useState } from 'react';
import type { RecordingEntry } from '../types';

const formatBytes = (bytes: number, locale: string) => new Intl.NumberFormat(locale, { notation: 'compact', style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
const withoutExtension = (name: string) => name.replace(/\.mkv$/i, '');

const RecordingThumbnail: React.FC<{ entry: RecordingEntry }> = ({ entry }) => {
  const { t } = useI18n();
  const previewRef = useRef<HTMLSpanElement>(null);
  const [dataUrl, setDataUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  useEffect(() => {
    let active = true;
    let observer: IntersectionObserver | null = null;
    const load = async () => {
      setStatus('loading');
      try {
        const result = await window.electron.getRecordingThumbnail(entry.id);
        if (!active) return;
        if (!result.ok || !result.dataUrl) {
          setStatus('failed');
          return;
        }
        setDataUrl(result.dataUrl);
        setStatus('ready');
      } catch {
        if (active) setStatus('failed');
      }
    };

    const target = previewRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      void load();
    } else {
      const root = target.closest('.recordings-library');
      observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer?.disconnect();
        observer = null;
        void load();
      }, { root, rootMargin: '180px' });
      observer.observe(target);
    }

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [entry.id, entry.bytes, entry.modifiedAtUtc]);

  return (
    <span ref={previewRef} className={`recording-card-preview recording-card-preview--${status}`} aria-hidden="true">
      {dataUrl && status === 'ready' ? (
        <img src={dataUrl} alt="" loading="lazy" decoding="async" onError={() => setStatus('failed')} />
      ) : (
          <span className="recording-preview-fallback">{t(status === 'failed' ? 'No preview' : 'Preparing')}</span>
      )}
      <span className="recording-preview-shade" />
    </span>
  );
};

export const RecordingsTab: React.FC<{ onBrowseChannels: () => void }> = ({ onBrowseChannels }) => {
  const { t, locale } = useI18n();
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<RecordingEntry | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [usingCompatibilityPlayer, setUsingCompatibilityPlayer] = useState(false);
  const [opening, setOpening] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setRecordings(await window.electron.listRecordings());
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to scan recordings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void window.electron.listRecordings()
      .then(entries => { if (active) setRecordings(entries); })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Unable to scan recordings.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => window.electron.onRecordingStateChange(state => {
    if (state.status !== 'completed' && state.status !== 'failed') return;
    void window.electron.listRecordings().then(setRecordings).catch(() => {});
  }), []);

  const openRecording = async (entry: RecordingEntry) => {
    if (expandedId === entry.id && playing?.id === entry.id) {
      setExpandedId(null);
      setPlaying(null);
      setPlaybackUrl('');
      setUsingCompatibilityPlayer(false);
      return;
    }

    setExpandedId(entry.id);
    setPlaying(null);
    setPlaybackUrl('');
    setUsingCompatibilityPlayer(false);
    setOpening(true);
    setMessage('');
    const result = await window.electron.getRecordingPlaybackUrl(entry.id);
    setOpening(false);
    if (!result.ok || !result.url) {
      setExpandedId(null);
      setMessage(result.error || 'Unable to open the recording.');
      return;
    }
    setPlaying(entry);
    setPlaybackUrl(result.url);
    setUsingCompatibilityPlayer(false);
  };

  const startCompatibilityPlayer = async () => {
    if (!playing || usingCompatibilityPlayer) return;
    setOpening(true);
    setMessage('Preparing compatibility player…');
    const result = await window.electron.startRecordingPlayback(playing.id);
    setOpening(false);
    if (!result.ok || !result.url) {
      setMessage(result.error || 'Unable to convert this recording for playback.');
      return;
    }
    setPlaybackUrl(result.url);
    setUsingCompatibilityPlayer(true);
    setMessage('');
  };

  const closeRecording = () => {
    setExpandedId(null);
    setPlaying(null);
    setPlaybackUrl('');
    setUsingCompatibilityPlayer(false);
    setOpening(false);
    setMessage('');
  };

  const rename = async (entry: RecordingEntry) => {
    const requested = window.prompt(t('Recording name'), withoutExtension(entry.name));
    if (!requested) return;
    const result = await window.electron.renameRecording({ id: entry.id, name: requested });
    setMessage(result.ok ? 'Recording renamed.' : result.error || 'Unable to rename the recording.');
    if (result.ok) await refresh();
  };

  const remove = async (entry: RecordingEntry) => {
    if (!window.confirm(t('Move “{name}” to Trash?', { name: entry.name }))) return;
    const result = await window.electron.deleteRecording(entry.id);
    setMessage(result.ok ? 'Recording moved to Trash.' : result.error || 'Unable to delete the recording.');
    if (result.ok) await refresh();
  };

  const totalBytes = recordings.reduce((total, entry) => total + entry.bytes, 0);

  return (
    <main className="recordings-library animate-fade">
      <header className="recordings-header">
        <div className="recordings-heading-copy">
          <div className="recordings-kicker-row">
            <span className="recordings-count">{recordings.length.toLocaleString(locale)} {t(recordings.length === 1 ? 'recording' : 'recordings')}</span>
          </div>
          <h2>{t("Recordings")}</h2>
        </div>
        <div className="recordings-header-aside">
          <div className="recordings-summary">
            <span>{t("Storage used")}</span>
            <strong>{formatBytes(totalBytes, locale)}</strong>
          </div>
          <div className="recordings-toolbar">
            <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={loading}>{t(loading ? 'Scanning…' : 'Refresh')}</button>
            <button type="button" className="btn-secondary" onClick={() => void window.electron.openRecordingDirectory()}>{t("Open folder")}</button>
          </div>
        </div>
      </header>

      {message && <p className="recordings-message" role="status">{t(message)}</p>}

      <section className="recordings-grid" aria-label={t("Available recordings")}>
        {recordings.map(entry => (
          <article className={`recording-card ${expandedId === entry.id ? 'is-expanded' : ''} ${playing?.id === entry.id ? 'is-playing' : ''}`} key={entry.id}>
            <div className="recording-card-row">
              <button
                type="button"
                className="recording-card-main"
                onClick={() => void openRecording(entry)}
                aria-expanded={expandedId === entry.id}
                aria-controls={`recording-panel-${entry.id}`}
                aria-label={`${t(expandedId === entry.id ? 'Close' : 'Play')} ${withoutExtension(entry.name)}`}
              >
                <RecordingThumbnail entry={entry} />
                <span className={`recording-play-icon ${expandedId === entry.id ? 'is-open' : ''}`} aria-hidden="true">{expandedId === entry.id ? '⌃' : '▶'}</span>
                <span className="recording-card-copy">
                  <strong title={entry.name}>{withoutExtension(entry.name)}</strong>
                  <small><span>{formatBytes(entry.bytes, locale)}</span><span aria-hidden="true">·</span><span>{new Date(entry.modifiedAtUtc).toLocaleString(locale)}</span></small>
                </span>
              </button>
              <div className="recording-card-actions">
                <button type="button" className="btn-secondary" onClick={() => void rename(entry)}>{t("Rename")}</button>
                <button type="button" className="recording-delete-button" onClick={() => void remove(entry)} aria-label={t('Move {name} to Trash', { name: entry.name })}>{t("Delete")}</button>
              </div>
            </div>
            {expandedId === entry.id && (
              <div className="recording-card-details" id={`recording-panel-${entry.id}`}>
                {playing?.id === entry.id && playbackUrl ? (
                  <div className="recording-inline-player" aria-label={t('Playing {name}', { name: playing.name })}>
                    <div className="recording-player-header">
                      <div><strong title={playing.name}>{withoutExtension(playing.name)}</strong></div>
                      <button type="button" className="recording-close-button" onClick={closeRecording}>{t("Close player")}</button>
                    </div>
                    <video
                      key={playbackUrl}
                      src={playbackUrl}
                      controls
                      autoPlay
                      playsInline
                      className="recording-player-video"
                      onError={() => {
                        if (usingCompatibilityPlayer) {
                          setMessage('The compatibility player could not open this recording.');
                          return;
                        }
                        void startCompatibilityPlayer();
                      }}
                    />
                    {opening && <div className="recording-player-loading">{t("Preparing video…")}</div>}
                    {!usingCompatibilityPlayer && !opening && <button type="button" className="recording-compatibility-link" onClick={() => void startCompatibilityPlayer()}>{t("Use compatibility player")}</button>}
                  </div>
                ) : (
                  <div className="recording-card-loading" role="status">
                    <span className="recording-loader" aria-hidden="true" />
                    <span>{t(opening ? 'Preparing video…' : 'Opening recording…')}</span>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </section>

      {!loading && recordings.length === 0 && <section className="recordings-empty"><strong>{t("No recordings yet.")}</strong><button type="button" className="btn-secondary" onClick={onBrowseChannels}>{t('Browse channels')}</button></section>}
    </main>
  );
};
