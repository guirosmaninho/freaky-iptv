import React, { useEffect, useState } from 'react';

export const DiagnosticsTab: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setReport(await window.electron.getDiagnostics());
  };

  useEffect(() => {
    let active = true;
    void window.electron.getDiagnostics().then(value => { if (active) setReport(value); });
    return () => { active = false; };
  }, []);

  return (
    <section className={`diagnostics-tab ${embedded ? 'diagnostics-tab--embedded' : 'settings-tab animate-fade'}`}>
      {!embedded && <div className="settings-header">
        <p className="page-eyebrow">Support</p>
        <h2>Diagnostics</h2>
        <p>Health information is redacted by default: no stream URLs, tokens, local paths or channel names are exported.</p>
      </div>}
      <div className="settings-section">
        {embedded && <p>Health information is redacted by default: no stream URLs, tokens, local paths or channel names are exported.</p>}
        <div className="settings-actions">
          <button className="btn-secondary" type="button" onClick={() => void refresh()}>Refresh</button>
          <button className="btn-primary" type="button" onClick={() => void window.electron.exportDiagnostics().then(result => setMessage(result.ok ? 'Diagnostics exported.' : 'Export cancelled.'))}>Export diagnostics</button>
        </div>
        {message && <p role="status">{message}</p>}
        <pre className="diagnostics-json" aria-label="Diagnostic report">{report ? JSON.stringify(report, null, 2) : 'Loading diagnostics…'}</pre>
      </div>
    </section>
  );
};
