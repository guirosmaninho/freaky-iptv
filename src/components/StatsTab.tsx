import { useI18n } from '../hooks/useI18n';
import { useEffect, useMemo, useState } from 'react';
import type { ComputedStats, HeatCell } from '../services/statsCalculator';
import { createStatsCardObjectUrl, renderStatsCard } from '../services/statsCardRenderer';

interface StatsTabProps {
  stats: ComputedStats;
  onRefreshStats: () => Promise<void>;
  onCopyStatsCard?: (png: Uint8Array) => Promise<void>;
  onSaveStatsCard?: (png: Uint8Array) => Promise<void>;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const StatsTab: React.FC<StatsTabProps> = ({ stats, onRefreshStats, onCopyStatsCard, onSaveStatsCard }) => {
  const { t, locale } = useI18n();
  const [activeListTab, setActiveListTab] = useState<'allTime' | 'lastMonth'>('allTime');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cardPng, setCardPng] = useState<Uint8Array | null>(null);
  const [cardPreviewUrl, setCardPreviewUrl] = useState('');
  const [cardError, setCardError] = useState('');
  const [isGeneratingCard, setIsGeneratingCard] = useState(false);
  const heatmapWeeks = useMemo(() => chunkWeeks(stats.heatmapCells), [stats.heatmapCells]);
  const topChannels = activeListTab === 'allTime' ? stats.topChannelsAllTime : stats.topChannelsLastMonth;

  useEffect(() => () => {
    if (cardPreviewUrl) URL.revokeObjectURL(cardPreviewUrl);
  }, [cardPreviewUrl]);

  const createCard = async () => {
    if (isGeneratingCard) return;
    setIsGeneratingCard(true);
    setCardError('');
    try {
      const png = await renderStatsCard(stats.shareCard);
      setCardPng(png);
      setCardPreviewUrl(createStatsCardObjectUrl(png));
    } catch (error) {
      setCardError(error instanceof Error ? error.message : 'Unable to create the statistics image.');
    } finally {
      setIsGeneratingCard(false);
    }
  };

  const copyCard = async () => {
    if (!cardPng) return;
    setCardError('');
    try {
      if (onCopyStatsCard) await onCopyStatsCard(cardPng);
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([cardPng.slice().buffer], { type: 'image/png' }) })]);
    } catch (error) {
      setCardError(error instanceof Error ? error.message : 'Unable to copy the statistics image.');
    }
  };

  const saveCard = async () => {
    if (!cardPng) return;
    setCardError('');
    try {
      if (onSaveStatsCard) await onSaveStatsCard(cardPng);
      else {
        const anchor = document.createElement('a');
        anchor.href = cardPreviewUrl;
        anchor.download = 'freaky-iptv-stats.png';
        anchor.click();
      }
    } catch (error) {
      setCardError(error instanceof Error ? error.message : 'Unable to save the statistics image.');
    }
  };

  const refreshStats = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setCardError('');
    try {
      await onRefreshStats();
    } catch (error) {
      setCardError(error instanceof Error ? error.message : 'Unable to load statistics.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectAdjacentTab = () => {
    const nextTab = activeListTab === 'allTime' ? 'lastMonth' : 'allTime';
    setActiveListTab(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(nextTab === 'allTime' ? 'stats-tab-all' : 'stats-tab-month')?.focus();
    });
  };

  const summaryCards: Array<{
    label: string;
    value: string;
    meta: string;
    detail?: string;
    tone: 'accent' | 'green' | 'muted' | 'orange';
  }> = [
    {
      label: 'Total watch time',
      value: stats.totalWatchTime,
      meta: t('{value} this month', { value: stats.monthWatchTime }),
      tone: 'accent'
    },
    {
      label: 'Measured data',
      value: stats.totalDataFormatted,
      meta: t('{value} this month', { value: stats.monthDataFormatted }),
      detail: stats.unmeasuredSessions !== '0'
        ? t('{count} sessions without reliable byte count ({duration})', { count: stats.unmeasuredSessions, duration: stats.unmeasuredWatchTime })
        : undefined,
      tone: 'green'
    },
    {
      label: 'Sessions count',
      value: stats.totalSessions,
      meta: t('Avg: {duration} per session', { duration: stats.avgSessionLength }),
      tone: 'muted'
    },
    {
      label: 'Peak timing',
      value: stats.peakHour,
      meta: t('Most active day: {day}', { day: stats.peakDay }),
      tone: 'muted'
    },
    {
      label: 'Longest session',
      value: stats.longestSession,
      meta: stats.longestSessionChannel || t('No session recorded'),
      detail: stats.longestSessionStartedAt ? t('Started {date}', { date: stats.longestSessionStartedAt }) : undefined,
      tone: 'orange'
    }
  ];

  return (
    <div className="stats-page animate-fade">
      <div className="stats-inner">
        <div className="stats-header">
          <div className="stats-heading">
            <h2>{t("Viewing statistics")}</h2>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={createCard} type="button" disabled={isGeneratingCard} aria-busy={isGeneratingCard}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <span>{t(isGeneratingCard ? 'Sharing…' : 'Share statistics')}</span>
            </button>
            <button className="btn-primary stats-refresh-button" onClick={refreshStats} type="button" disabled={isRefreshing} aria-busy={isRefreshing}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>{t(isRefreshing ? 'Refreshing…' : 'Refresh Stats')}</span>
            </button>
          </div>
        </div>

        <section className="stats-summary-grid" aria-label={t("Statistics summary")}>
          {summaryCards.map(card => (
            <article className="stats-summary-card glass-card" key={card.label}>
              <span className="stats-card-label">{t(card.label)}</span>
              <strong className="stats-card-value" title={card.value}>{card.value}</strong>
              <span className={`stats-card-meta stats-card-meta--${card.tone}`} title={card.meta}>
                {card.meta}
              </span>
              {card.detail && (
                <span className="stats-card-detail" title={card.detail}>
                  {card.detail}
                </span>
              )}
            </article>
          ))}
        </section>

        <section className="stats-panel stats-heatmap-panel glass-card">
          <div className="stats-panel-header">
            <h3>{t("Daily Activity History")}</h3>
            <span>{stats.heatmapStartMonth} - {stats.heatmapEndMonth}</span>
          </div>

          <div className="stats-heatmap-scroll">
            <div className="stats-heatmap">
              <div className="stats-heatmap-days" aria-hidden="true">
                {dayLabels.map(label => (
                  <span key={label}>{t(label)}</span>
                ))}
              </div>

              <div className="stats-heatmap-weeks" role="list" aria-label={t("Daily activity for the last year")}>
                {heatmapWeeks.map((week, weekIndex) => (
                  <div className="stats-heatmap-week" key={weekIndex} role="presentation">
                    {week.map((cell) => {
                      const isFuture = cell.date.getTime() > Date.now();
                      return (
                        <span
                          role="listitem"
                          className="stats-heatmap-cell"
                          key={cell.dateString}
                          data-tooltip={isFuture ? undefined : cell.tooltip}
                          data-tooltip-placement={getEdgeTooltipPlacement(weekIndex, heatmapWeeks.length)}
                          aria-label={isFuture ? undefined : cell.tooltip}
                          style={{
                            '--activity-level': cell.intensity,
                            visibility: isFuture ? 'hidden' : undefined
                          } as React.CSSProperties}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="stats-heatmap-legend" aria-hidden="true">
            <span>{t("Less")}</span>
            <i style={{ '--activity-level': 0 } as React.CSSProperties} />
            <i style={{ '--activity-level': .25 } as React.CSSProperties} />
            <i style={{ '--activity-level': .5 } as React.CSSProperties} />
            <i style={{ '--activity-level': .75 } as React.CSSProperties} />
            <i style={{ '--activity-level': 1 } as React.CSSProperties} />
            <span>{t("More")}</span>
          </div>
        </section>

        <div className="stats-distribution-grid">
          <section className="stats-panel glass-card">
            <div className="stats-panel-header">
              <h3>{t("Hourly Activity Distribution")}</h3>
            </div>

            <div className="stats-hour-chart" role="list" aria-label={t("Hourly activity distribution")}>
              {stats.hourBars.map(bar => (
                <span
                  className="stats-hour-bar-shell"
                  key={bar.hour}
                  data-tooltip={bar.tooltip}
                  data-tooltip-placement={getHourTooltipPlacement(bar.hour)}
                  aria-label={bar.tooltip}
                  role="listitem"
                  tabIndex={0}
                >
                  <span
                    className="stats-hour-bar"
                    style={{ height: `${Math.max(2, bar.fraction * 100)}%`, opacity: bar.fraction > 0 ? 0.9 : 0.16 }}
                  />
                </span>
              ))}
            </div>

            <div className="stats-hour-axis" aria-hidden="true">
              <span>{t("12 AM")}</span>
              <span>{t("6 AM")}</span>
              <span>{t("12 PM")}</span>
              <span>{t("6 PM")}</span>
              <span>{t("11 PM")}</span>
            </div>
          </section>

          <section className="stats-panel glass-card">
            <div className="stats-panel-header">
              <h3>{t("Weekly Distribution")}</h3>
            </div>

            <div className="stats-week-list">
              {stats.dayBars.map(day => (
                <div className="stats-week-row" key={day.dayName}>
                  <span>{day.dayName}</span>
                  <div className="stats-week-track">
                    <span style={{ width: `${day.fraction * 100}%`, opacity: day.fraction > 0 ? 0.9 : 0.14 }} />
                  </div>
                  <strong>{day.totalMs > 0 ? formatDurationShort(day.totalMs) : '0m'}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="stats-panel stats-top-panel glass-card">
          <div className="stats-top-header">
            <h3>{t("Top 10 Watched Channels")}</h3>

            <div className="stats-segmented-control" role="tablist" aria-label={t("Top channel period")}>
              <button
                id="stats-tab-all"
                type="button"
                role="tab"
                aria-selected={activeListTab === 'allTime'}
                aria-controls="stats-top-panel"
                tabIndex={activeListTab === 'allTime' ? 0 : -1}
                onClick={() => setActiveListTab('allTime')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    selectAdjacentTab();
                  }
                }}
              >{t("All Time")}</button>
              <button
                id="stats-tab-month"
                type="button"
                role="tab"
                aria-selected={activeListTab === 'lastMonth'}
                aria-controls="stats-top-panel"
                tabIndex={activeListTab === 'lastMonth' ? 0 : -1}
                onClick={() => setActiveListTab('lastMonth')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    selectAdjacentTab();
                  }
                }}
              >{t("This Month")}</button>
            </div>
          </div>

          <div className="stats-top-list" id="stats-top-panel" role="tabpanel" aria-labelledby={activeListTab === 'allTime' ? 'stats-tab-all' : 'stats-tab-month'}>
            {topChannels.length > 0 ? (
              topChannels.map((entry, index) => (
                <article className="stats-top-row" key={`${entry.name}-${index}`}>
                  <div className="stats-top-row-main">
                    <span className="stats-top-rank">{index + 1}</span>
                    <span className="stats-top-name" title={entry.name}>{entry.name}</span>
                    <span className="stats-top-group" title={entry.group}>{entry.group || t('Uncategorised')}</span>
                  </div>

                  <div className="stats-top-row-meta">
                    <span>{formatDurationShort(entry.totalTimeMs)}</span>
                    <span>{t('({count} sessions)', { count: entry.sessionCount.toLocaleString(locale) })}</span>
                  </div>

                  <div className="stats-top-progress" aria-hidden="true">
                    <span style={{ width: `${entry.barFraction * 100}%` }} />
                  </div>
                </article>
              ))
            ) : (
              <div className="stats-empty-state">{t("No history recorded for this period.")}</div>
            )}
          </div>
        </section>
      </div>
      {cardPreviewUrl && cardPng && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-card-dialog-title"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(4, 7, 6, 0.78)' }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCardPreviewUrl('');
          }}
        >
          <section className="glass-card" style={{ width: 'min(960px, 94vw)', padding: 20, background: '#151918', border: '1px solid rgba(255,255,255,.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 id="stats-card-dialog-title" style={{ margin: 0 }}>{t("Share viewing statistics")}</h3>
              </div>
              <button className="btn-secondary" type="button" onClick={() => setCardPreviewUrl('')} aria-label={t("Close image preview")}>{t("Close")}</button>
            </div>
            <img src={cardPreviewUrl} alt={t("Preview of the Freaky IPTV viewing statistics card")} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 16, background: '#111413' }} />
            {cardError && <p role="alert" style={{ color: '#ff9b8f', margin: '12px 0 0' }}>{t(cardError)}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn-secondary" type="button" onClick={copyCard}>{t("Copy image")}</button>
              <button className="btn-primary" type="button" onClick={saveCard}>{t("Save PNG")}</button>
            </div>
          </section>
        </div>
      )}
      {!cardPreviewUrl && cardError && <p role="alert" style={{ color: '#ff9b8f', margin: 16 }}>{t(cardError)}</p>}
    </div>
  );
};

function chunkWeeks(cells: HeatCell[]): HeatCell[][] {
  const weeks: HeatCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function getEdgeTooltipPlacement(index: number, total: number): 'left' | 'right' | undefined {
  if (index < 5) return 'right';
  if (index >= total - 5) return 'left';
  return undefined;
}

function getHourTooltipPlacement(hour: number): 'left' | 'right' | undefined {
  if (hour < 3) return 'right';
  if (hour > 20) return 'left';
  return undefined;
}

function formatDurationShort(ms: number): string {
  const mins = ms / (60 * 1000);
  const hours = mins / 60;

  if (hours >= 1) {
    return `${Math.floor(hours)}h ${Math.floor(mins % 60)}m`;
  }
  if (mins >= 1) {
    return `${Math.floor(mins)}m`;
  }
  return `${Math.floor(ms / 1000)}s`;
}
