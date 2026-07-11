import React, { useEffect, useState } from 'react';
import type { UpdateCheckResult } from '../types';

const PROJECT_URL = 'https://github.com/guirosmaninho/freaky-iptv';

const INITIAL_UPDATE_STATE: UpdateCheckResult = {
  status: 'idle',
  target: '',
  version: '',
  notes: '',
  progress: 0,
  message: ''
};

export const AboutTab: React.FC = () => {
  const [version, setVersion] = useState('1.0.1');
  const [update, setUpdate] = useState<UpdateCheckResult>(INITIAL_UPDATE_STATE);
  const [isUpdateBusy, setIsUpdateBusy] = useState(false);

  useEffect(() => {
    window.electron.getAppVersion().then(setVersion).catch(() => {});
    return window.electron.onUpdateStatus((nextState) => {
      setUpdate(nextState);
      if (!['checking', 'downloading'].includes(nextState.status)) setIsUpdateBusy(false);
    });
  }, []);

  const openExternalUrl = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    window.electron.openExternalUrl(url).catch(() => {});
  };

  const runUpdateAction = async (action: () => Promise<UpdateCheckResult>) => {
    setIsUpdateBusy(true);
    try {
      setUpdate(await action());
    } catch {
      setUpdate({
        ...INITIAL_UPDATE_STATE,
        status: 'error',
        message: 'Não foi possível concluir a atualização. Tente novamente.'
      });
    } finally {
      setIsUpdateBusy(false);
    }
  };

  const updateAction = update.status === 'available' && update.target === 'release-page'
    ? { label: 'Abrir Releases no GitHub', action: () => runUpdateAction(async () => {
      await window.electron.openReleasePage();
      return { ...update, message: 'As Releases do GitHub foram abertas no navegador.' };
    }) }
    : update.status === 'available'
      ? { label: `Descarregar atualização ${update.version}`, action: () => runUpdateAction(window.electron.downloadUpdate) }
    : update.status === 'downloaded'
      ? { label: 'Reiniciar e instalar', action: () => runUpdateAction(window.electron.installUpdate) }
      : { label: isUpdateBusy ? 'A procurar atualizações…' : 'Procurar atualizações', action: () => runUpdateAction(window.electron.checkForUpdates) };

  return (
    <div className="about-page animate-fade">
      <div className="about-hero-card">
        <div className="about-hero-glow" aria-hidden="true" />
        <img
          src={`${import.meta.env.BASE_URL}cat_icon.png`}
          alt="Freaky IPTV"
          className="about-logo"
          decoding="async"
        />
        <h1 className="about-title">Freaky IPTV</h1>
        <p className="about-subtitle">Experience IPTV the <span className="freaky-glow">freaky way</span>.</p>
        <p className="about-description">
          A desktop client for IPTV playlists with playback metrics, EPG coordination,
          channel quality grouping, and encrypted backups.
        </p>
      </div>

      <div className="about-grid">
        <div className="about-card">
          <h2 className="about-card-title">Version Information</h2>
          <div className="about-info-rows">
            <div className="about-info-row about-version-row">
              <span className="about-info-label">App Version</span>
              <div className="about-version-actions">
                <span className="about-info-value version-badge">{version}</span>
                <button
                  type="button"
                  className="about-submit-button about-version-update-button"
                  onClick={updateAction.action}
                  disabled={isUpdateBusy || update.status === 'checking' || update.status === 'downloading' || update.status === 'installing'}
                >
                  {update.status === 'downloading' ? `A transferir ${update.progress}%` : update.status === 'installing' ? 'A instalar…' : updateAction.label}
                </button>
              </div>
            </div>
            <div className="about-info-row">
              <span className="about-info-label">GitHub Project</span>
              <a
                href={PROJECT_URL}
                onClick={(event) => openExternalUrl(event, PROJECT_URL)}
                className="about-link"
              >
                guirosmaninho/freaky-iptv
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '4px' }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
            <div className="about-info-row">
              <span className="about-info-label">License</span>
              <span className="about-info-value">MIT License</span>
            </div>
          </div>
        </div>

        <div className="about-card">
          <h2 className="about-card-title">Technology Stack</h2>
          <p className="about-card-text">
            React, TypeScript, Electron, Vite, .NET 8, LibVLC, and FFmpeg.
          </p>
        </div>
      </div>

      <section className="about-card about-updates" aria-labelledby="about-updates-title">
        <div>
          <h2 id="about-updates-title" className="about-card-title">Atualizações</h2>
          <p className="about-card-text">
            Procure novas versões publicadas no GitHub. No macOS, uma nova versão abre as Releases no navegador; no Windows, a transferência e instalação só começam após a sua confirmação.
          </p>
        </div>
        <div className="about-update-status" role="status" aria-live="polite">
          {update.status === 'idle' && 'Ainda não procurou atualizações nesta sessão.'}
          {update.message && update.message}
          {update.status === 'downloading' && <progress value={update.progress} max="100">{update.progress}%</progress>}
          {update.status === 'available' && <strong>Atualização disponível: {update.version}</strong>}
          {update.status === 'downloaded' && <strong>Atualização pronta para instalar.</strong>}
        </div>
        {update.notes && (
          <details className="about-update-notes">
            <summary>Notas da versão {update.version}</summary>
            <pre>{update.notes}</pre>
          </details>
        )}
        <div className="about-update-actions">
          {update.target === 'portable' && update.status === 'downloaded' && (
            <span className="about-update-note">A app será encerrada e o executável portátil será substituído no mesmo directório.</span>
          )}
          {update.target === 'release-page' && update.status === 'available' && (
            <span className="about-update-note">Descarregue o DMG adequado ao processador do seu Mac nas Releases do GitHub.</span>
          )}
        </div>
      </section>

      <div className="about-footer">
        <p>&copy; {new Date().getFullYear()} Freaky IPTV. Released under the MIT License.</p>
      </div>
    </div>
  );
};
