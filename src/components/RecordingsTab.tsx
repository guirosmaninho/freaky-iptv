import React, { useEffect, useState } from 'react';
import type { RecordingEntry } from '../types';

const formatBytes = (bytes: number) => new Intl.NumberFormat(undefined, { notation: 'compact', style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
const withoutExtension = (name: string) => name.replace(/\.mkv$/i, '');

export const RecordingsTab: React.FC = () => {
  const [recordings, setRecordings] = useState<RecordingEntry[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<RecordingEntry | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [usingCompatibilityPlayer, setUsingCompatibilityPlayer] = useState(false);
  const [opening, setOpening] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setRecordings(await window.electron.listRecordings());
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível analisar as gravações.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void window.electron.listRecordings()
      .then(entries => { if (active) setRecordings(entries); })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Não foi possível analisar as gravações.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => window.electron.onRecordingStateChange(state => {
    if (state.status !== 'completed' && state.status !== 'failed') return;
    void window.electron.listRecordings().then(setRecordings).catch(() => {});
  }), []);

  const openRecording = async (entry: RecordingEntry) => {
    setOpening(true);
    setMessage('');
    const result = await window.electron.getRecordingPlaybackUrl(entry.id);
    setOpening(false);
    if (!result.ok || !result.url) {
      setMessage(result.error || 'Não foi possível abrir a gravação.');
      return;
    }
    setPlaying(entry);
    setPlaybackUrl(result.url);
    setUsingCompatibilityPlayer(false);
  };

  const startCompatibilityPlayer = async () => {
    if (!playing || usingCompatibilityPlayer) return;
    setOpening(true);
    setMessage('A preparar o leitor de compatibilidade…');
    const result = await window.electron.startRecordingPlayback(playing.id);
    setOpening(false);
    if (!result.ok || !result.url) {
      setMessage(result.error || 'Não foi possível converter esta gravação para reprodução.');
      return;
    }
    setPlaybackUrl(result.url);
    setUsingCompatibilityPlayer(true);
    setMessage('');
  };

  const rename = async (entry: RecordingEntry) => {
    const requested = window.prompt('Nome da gravação', withoutExtension(entry.name));
    if (!requested) return;
    const result = await window.electron.renameRecording({ id: entry.id, name: requested });
    setMessage(result.ok ? 'Gravação renomeada.' : result.error || 'Não foi possível renomear a gravação.');
    if (result.ok) await refresh();
  };

  const remove = async (entry: RecordingEntry) => {
    if (!window.confirm(`Mover “${entry.name}” para o Lixo?`)) return;
    const result = await window.electron.deleteRecording(entry.id);
    setMessage(result.ok ? 'Gravação movida para o Lixo.' : result.error || 'Não foi possível eliminar a gravação.');
    if (result.ok) await refresh();
  };

  return (
    <main className="recordings-library animate-fade">
      <header className="recordings-header">
        <div>
          <p className="recordings-kicker">Biblioteca local</p>
          <h2>Gravações</h2>
          <p>Reproduz, organiza e remove as gravações guardadas nesta app.</p>
        </div>
        <div className="recordings-toolbar">
          <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={loading}>{loading ? 'A analisar…' : 'Atualizar'}</button>
          <button type="button" className="btn-secondary" onClick={() => void window.electron.openRecordingDirectory()}>Abrir pasta</button>
        </div>
      </header>

      {message && <p className="recordings-message" role="status">{message}</p>}

      {playing && playbackUrl && (
        <section className="recording-player" aria-label={`A reproduzir ${playing.name}`}>
          <div className="recording-player-header">
            <div><span>A reproduzir</span><strong title={playing.name}>{withoutExtension(playing.name)}</strong></div>
            <button type="button" className="btn-secondary" onClick={() => { setPlaying(null); setPlaybackUrl(''); setMessage(''); }}>Fechar</button>
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
                setMessage('O leitor de compatibilidade não conseguiu abrir esta gravação.');
                return;
              }
              void startCompatibilityPlayer();
            }}
          />
          {opening && <div className="recording-player-loading">A preparar vídeo…</div>}
          {!usingCompatibilityPlayer && !opening && <button type="button" className="recording-compatibility-link" onClick={() => void startCompatibilityPlayer()}>Este vídeo não abre? Usar leitor de compatibilidade</button>}
        </section>
      )}

      <section className="recordings-grid" aria-label="Gravações disponíveis">
        {recordings.map(entry => (
          <article className={`recording-card ${playing?.id === entry.id ? 'is-playing' : ''}`} key={entry.id}>
            <button type="button" className="recording-card-main" onClick={() => void openRecording(entry)}>
              <span className="recording-play-icon" aria-hidden="true">▶</span>
              <span className="recording-card-copy"><strong title={entry.name}>{withoutExtension(entry.name)}</strong><small>{formatBytes(entry.bytes)} · {new Date(entry.modifiedAtUtc).toLocaleString()}</small></span>
            </button>
            <div className="recording-card-actions">
              <button type="button" className="btn-secondary" onClick={() => void rename(entry)}>Renomear</button>
              <button type="button" className="recording-delete-button" onClick={() => void remove(entry)} aria-label={`Mover ${entry.name} para o Lixo`}>Eliminar</button>
            </div>
          </article>
        ))}
      </section>

      {!loading && recordings.length === 0 && <section className="recordings-empty"><strong>Ainda não há gravações.</strong><span>Inicia uma gravação num canal e ela aparecerá aqui quando terminar.</span></section>}
    </main>
  );
};
