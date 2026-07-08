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
    try {
      await onRefreshStats();
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
      label: 'TOTAL WATCH TIME',
      value: stats.totalWatchTime,
      meta: `${stats.monthWatchTime} this month`,
      tone: 'accent'
    },
    {
      label: 'MEASURED DATA',
      value: stats.totalDataFormatted,
      meta: `${stats.monthDataFormatted} this month`,
      detail: stats.unmeasuredSessions !== '0'
        ? `${stats.unmeasuredSessions} sessions without reliable byte count (${stats.unmeasuredWatchTime})`
        : undefined,
      tone: 'green'
    },
    {
      label: 'SESSIONS COUNT',
      value: stats.totalSessions,
      meta: `Avg: ${stats.avgSessionLength} per session`,
      tone: 'muted'
    },
    {
      label: 'PEAK TIMING',
      value: stats.peakHour,
      meta: `Most active day: ${stats.peakDay}`,
      tone: 'muted'
    },
    {
      label: 'LONGEST SESSION',
      value: stats.longestSession,
      meta: stats.longestSessionChannel || 'No session recorded',
      detail: stats.longestSessionStartedAt ? `Started ${stats.longestSessionStartedAt}` : undefined,
      tone: 'orange'
    }
  ];

  return (
    <div className="stats-page animate-fade">
      <div className="stats-inner">
        <div className="stats-header">
          <div className="stats-heading">
            <p className="page-eyebrow">Activity</p>
            <h2>Viewing statistics</h2>
            <p>Your viewing habits, data usage, and watch history records.</p>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={createCard} type="button" disabled={isGeneratingCard} aria-busy={isGeneratingCard}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px' }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <span>{isGeneratingCard ? 'Sharing…' : 'Share statistics'}</span>
            </button>
            <button className="btn-primary stats-refresh-button" onClick={refreshStats} type="button" disabled={isRefreshing} aria-busy={isRefreshing}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>{isRefreshing ? 'Refreshing…' : 'Refresh Stats'}</span>
            </button>
          </div>
        </div>

        <section className="stats-summary-grid" aria-label="Statistics summary">
          {summaryCards.map(card => (
            <article className="stats-summary-card glass-card" key={card.label}>
              <span className="stats-card-label">{card.label}</span>
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
            <h3>Daily Activity History</h3>
            <span>{stats.heatmapStartMonth} - {stats.heatmapEndMonth}</span>
          </div>

          <div className="stats-heatmap-scroll">
            <div className="stats-heatmap">
              <div className="stats-heatmap-days" aria-hidden="true">
                {dayLabels.map(label => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div className="stats-heatmap-weeks" role="list" aria-label="Daily activity for the last year">
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
                            '--activity': cell.intensity === 0
                              ? 'rgba(255, 255, 255, 0.045)'
                              : `rgba(32, 208, 113, ${cell.intensity})`,
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
            <span>Less</span>
            <i style={{ '--activity': 'rgba(255, 255, 255, 0.045)' } as React.CSSProperties} />
            <i style={{ '--activity': 'rgba(32, 208, 113, 0.25)' } as React.CSSProperties} />
            <i style={{ '--activity': 'rgba(32, 208, 113, 0.5)' } as React.CSSProperties} />
            <i style={{ '--activity': 'rgba(32, 208, 113, 0.75)' } as React.CSSProperties} />
            <i style={{ '--activity': 'rgba(32, 208, 113, 1)' } as React.CSSProperties} />
            <span>More</span>
          </div>
        </section>

        <div className="stats-distribution-grid">
          <section className="stats-panel glass-card">
            <div className="stats-panel-header">
              <h3>Hourly Activity Distribution</h3>
            </div>

            <div className="stats-hour-chart" role="list" aria-label="Hourly activity distribution">
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
              <span>12 AM</span>
              <span>6 AM</span>
              <span>12 PM</span>
              <span>6 PM</span>
              <span>11 PM</span>
            </div>
          </section>

          <section className="stats-panel glass-card">
            <div className="stats-panel-header">
              <h3>Weekly Distribution</h3>
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
            <h3>Top 10 Watched Channels</h3>

            <div className="stats-segmented-control" role="tablist" aria-label="Top channel period">
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
              >
                All Time
              </button>
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
              >
                This Month
              </button>
            </div>
          </div>

          <div className="stats-top-list" id="stats-top-panel" role="tabpanel" aria-labelledby={activeListTab === 'allTime' ? 'stats-tab-all' : 'stats-tab-month'}>
            {topChannels.length > 0 ? (
              topChannels.map((entry, index) => (
                <article className="stats-top-row" key={`${entry.name}-${index}`}>
                  <div className="stats-top-row-main">
                    <span className="stats-top-rank">{index + 1}</span>
                    <span className="stats-top-name" title={entry.name}>{entry.name}</span>
                    <span className="stats-top-group" title={entry.group}>{entry.group || 'Uncategorised'}</span>
                  </div>

                  <div className="stats-top-row-meta">
                    <span>{formatDurationShort(entry.totalTimeMs)}</span>
                    <span>({entry.sessionCount} sessions)</span>
                  </div>

                  <div className="stats-top-progress" aria-hidden="true">
                    <span style={{ width: `${entry.barFraction * 100}%` }} />
                  </div>
                </article>
              ))
            ) : (
              <div className="stats-empty-state">
                No history recorded for this period.
              </div>
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
                <h3 id="stats-card-dialog-title" style={{ margin: 0 }}>Share viewing statistics</h3>
                <p style={{ margin: '6px 0 0', opacity: 0.7 }}>PNG · 1200 × 736 · last 365 days</p>
              </div>
              <button className="btn-secondary" type="button" onClick={() => setCardPreviewUrl('')} aria-label="Close image preview">Close</button>
            </div>
            <img src={cardPreviewUrl} alt="Preview of the Freaky IPTV viewing statistics card" style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 16, background: '#111413' }} />
            {cardError && <p role="alert" style={{ color: '#ff9b8f', margin: '12px 0 0' }}>{cardError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn-secondary" type="button" onClick={copyCard}>Copy image</button>
              <button className="btn-primary" type="button" onClick={saveCard}>Save PNG</button>
            </div>
          </section>
        </div>
      )}
      {!cardPreviewUrl && cardError && <p role="alert" style={{ color: '#ff9b8f', margin: 16 }}>{cardError}</p>}
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
