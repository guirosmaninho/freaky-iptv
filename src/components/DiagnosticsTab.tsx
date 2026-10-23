import { useI18n } from '../hooks/useI18n';
import React, { useEffect, useState } from 'react';

export const DiagnosticsTab: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useI18n();
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
        <h2>{t("Diagnostics")}</h2>
      </div>}
      <div className="settings-section">
        <div className="settings-actions">
          <button className="btn-secondary" type="button" onClick={() => void refresh()}>{t("Refresh")}</button>
          <button className="btn-primary" type="button" onClick={() => void window.electron.exportDiagnostics().then(result => setMessage(result.ok ? 'Diagnostics exported.' : 'Export cancelled.'))}>{t("Export diagnostics")}</button>
        </div>
        {message && <p role="status">{t(message)}</p>}
        <pre className="diagnostics-json" aria-label={t("Diagnostic report")}>{report ? JSON.stringify(report, null, 2) : t('Loading diagnostics…')}</pre>
      </div>
    </section>
  );
};
