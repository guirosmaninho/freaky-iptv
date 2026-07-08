import React, { useEffect, useState } from 'react';

const PROJECT_URL = 'https://github.com/guirosmaninho/freaky-iptv';
const NEW_ISSUE_URL = 'https://github.com/guirosmaninho/freaky-iptv/issues/new';

export const AboutTab: React.FC = () => {
  const [version, setVersion] = useState('1.0.0');

  useEffect(() => {
    window.electron.getAppVersion().then(setVersion).catch(() => {});
  }, []);

  const openExternalUrl = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    window.electron.openExternalUrl(url).catch(() => {});
  };

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
            <div className="about-info-row">
              <span className="about-info-label">App Version</span>
              <span className="about-info-value version-badge">{version}</span>
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
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
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

      <section className="about-card about-bug-report">
        <div className="about-bug-report-header">
          <div>
            <h2 className="about-card-title">Report a bug</h2>
            <p className="about-card-text">
              Create a GitHub issue and include the app version, expected result, actual result, and reproduction steps.
            </p>
          </div>
        </div>
        <div className="about-report-actions">
          <a
            href={NEW_ISSUE_URL}
            onClick={(event) => openExternalUrl(event, NEW_ISSUE_URL)}
            className="about-submit-button"
          >
            Create GitHub issue
          </a>
        </div>
      </section>

      <div className="about-footer">
        <p>&copy; {new Date().getFullYear()} Freaky IPTV. Released under the MIT License.</p>
      </div>
    </div>
  );
};
