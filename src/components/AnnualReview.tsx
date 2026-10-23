import { useI18n } from '../hooks/useI18n';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnualReviewData, ReviewNamedTotal, ReviewTimelinePoint } from '../types';
import { formatBytes, formatDuration } from '../services/statsCalculator';
import { getLargestTimelinePoint } from '../services/reviewCalculator';

interface AnnualReviewProps {
  data: AnnualReviewData;
  onExit: () => void;
}

interface Chapter {
  id: string;
  title: string;
  content: React.ReactNode;
}

export const AnnualReview: React.FC<AnnualReviewProps> = ({ data, onExit }) => {
  const { t, locale } = useI18n();
  const [chapterIndex, setChapterIndex] = useState(0);
  const chapterRef = useRef<HTMLElement>(null);
  const chapters = useMemo(() => buildChapters(data, t, locale), [data, t, locale]);
  const chapter = chapters[Math.min(chapterIndex, chapters.length - 1)];

  useEffect(() => {
    chapterRef.current?.focus();
  }, [chapterIndex]);

  const goBack = () => setChapterIndex(current => Math.max(0, current - 1));
  const goForward = () => {
    if (chapterIndex === chapters.length - 1) onExit();
    else setChapterIndex(current => Math.min(chapters.length - 1, current + 1));
  };

  return (
    <section
      ref={chapterRef}
      className={`annual-review annual-review--chapter-${(chapterIndex % 10) + 1}`}
      aria-label={t('{year} Year Review', { year: data.summary.period.year })}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goBack();
        } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
          event.preventDefault();
          goForward();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onExit();
        }
      }}
    >
      <div className="annual-review-orbit annual-review-orbit--one" aria-hidden="true" />
      <div className="annual-review-orbit annual-review-orbit--two" aria-hidden="true" />

      <header className="annual-review-header">
        <div className="annual-review-progress" aria-label={t('Chapter {current} of {total}', { current: chapterIndex + 1, total: chapters.length })}>
          {chapters.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={index <= chapterIndex ? 'is-complete' : ''}
              aria-label={t('Go to chapter {number}: {title}', { number: index + 1, title: item.title })}
              aria-current={index === chapterIndex ? 'step' : undefined}
              onClick={() => setChapterIndex(index)}
            />
          ))}
        </div>
        <button type="button" className="annual-review-close" onClick={onExit} aria-label={t("Exit Year Review")}>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ display: 'block' }}
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>

      <article className="annual-review-chapter" key={chapter.id} aria-live="polite">
        <h2>{chapter.title}</h2>
        <div className="annual-review-content">{chapter.content}</div>
      </article>

      <footer className="annual-review-footer">
        <button type="button" onClick={goBack} disabled={chapterIndex === 0}>{t("Previous")}</button>
        <span>{chapterIndex + 1} / {chapters.length}</span>
        <button type="button" onClick={goForward}>{t(chapterIndex === chapters.length - 1 ? 'Finish' : 'Next')}</button>
      </footer>
    </section>
  );
};

function buildChapters(data: AnnualReviewData, t: ReturnType<typeof useI18n>['t'], locale: string): Chapter[] {
  const { summary } = data;
  const biggestWeekday = getLargestTimelinePoint(data.weekdayTotals);
  const peakHour = getLargestTimelinePoint(data.hourTotals);
  const chapters: Chapter[] = [
    {
      id: 'opening',
      title: t('{year} Year Review', { year: summary.period.year }),
      content: (
        <div className="annual-review-hero-number">
          <strong>{formatDuration(summary.totalWatchMs)}</strong>
          <span>{t('That is {days} full days of viewing.', { days: data.equivalentDays.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
        </div>
      )
    },
    {
      id: 'overview',
      title: t('Overview'),
      content: (
        <MetricGrid items={[
          ['Sessions', summary.sessionCount.toLocaleString(locale)],
          ['Active days', summary.activeDays.toLocaleString(locale)],
          ['Unique channels', summary.uniqueChannelCount.toLocaleString(locale)],
          ['Average active day', formatDuration(summary.averagePerActiveDayMs)],
          ...(summary.measuredBytes !== null ? [['Measured data', formatBytes(summary.measuredBytes)]] : [])
        ]} />
      )
    },
    {
      id: 'favourite',
      title: summary.favoriteChannel?.name || t('Favourite channel'),
      content: summary.favoriteChannel ? (
        <div className="annual-review-favourite">
          <strong>{Math.round(summary.favoriteChannel.share * 100)}%</strong>
          <span>{t('{duration} across {count} sessions', { duration: formatDuration(summary.favoriteChannel.totalTimeMs), count: summary.favoriteChannel.sessionCount.toLocaleString(locale) })}</span>
          <small>{summary.favoriteChannel.group}</small>
        </div>
      ) : null
    },
    {
      id: 'ranking',
      title: t('Top channels'),
      content: <RankingList entries={data.topChannels.map(item => ({ name: item.name, totalTimeMs: item.totalTimeMs, share: item.share }))} />
    }
  ];

  if (data.topGroups.length > 0) {
    chapters.push({
      id: 'groups',
      title: t('Categories'),
      content: <RankingList entries={data.topGroups.slice(0, 5)} />
    });
  }

  chapters.push(
    {
      id: 'rhythm',
      title: t('Viewing activity'),
      content: <MetricGrid items={[
        ['Favourite weekday', biggestWeekday?.label || '—'],
        ['Peak hour', peakHour?.label || '—'],
        ['Biggest date', summary.busiestDayLabel || '—'],
        ['That day', formatDuration(summary.busiestDayMs)]
      ]} />
    },
    {
      id: 'timeline',
      title: t('Monthly activity'),
      content: <Timeline points={data.monthlyTotals} />
    },
    {
      id: 'milestones',
      title: t('Milestones'),
      content: <MetricGrid items={[
        ['Longest session', formatDuration(summary.longestSessionMs)],
        ['On', summary.longestSessionChannel || '—'],
        ['Longest streak', t('{count} days', { count: data.longestStreakDays.toLocaleString(locale) })],
        ['Biggest week', data.busiestWeekLabel || '—'],
        ['Week total', formatDuration(data.busiestWeekMs)]
      ]} />
    }
  );

  const telemetryItems = buildTelemetryItems(data, locale);
  if (data.qualityTotals.length > 0 || data.streamModeTotals.length > 0 || telemetryItems.length > 0) {
    chapters.push({
      id: 'playback',
      title: t('Playback'),
      content: (
        <div className="annual-review-playback-grid">
          {data.qualityTotals.length > 0 && <Distribution title={t("Quality")} entries={data.qualityTotals} />}
          {data.streamModeTotals.length > 0 && <Distribution title={t("Playback")} entries={data.streamModeTotals} />}
          {telemetryItems.length > 0 && <MetricGrid items={telemetryItems} />}
        </div>
      )
    });
  }

  chapters.push({
    id: 'finale',
    title: t('Year Review'),
    content: (
      <div className="annual-review-finale">
        <strong>{summary.period.year}</strong>
        <span>{t('{duration} · {channels} channels · {days} active days', { duration: formatDuration(summary.totalWatchMs), channels: summary.uniqueChannelCount.toLocaleString(locale), days: summary.activeDays.toLocaleString(locale) })}</span>
      </div>
    )
  });
  return chapters;
}

const MetricGrid: React.FC<{ items: string[][] }> = ({ items }) => {
  const { t } = useI18n();
  return (
    <div className="annual-review-metric-grid">
      {items.map(([label, value]) => (
        <div key={label}><span>{t(label)}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
};

const RankingList: React.FC<{ entries: Array<{ name: string; totalTimeMs: number; share: number }> }> = ({ entries }) => (
  <ol className="annual-review-ranking">
    {entries.map((entry, index) => (
      <li key={entry.name} style={{ '--rank-delay': `${index * 70}ms` } as React.CSSProperties}>
        <b>{index + 1}</b>
        <span><strong>{entry.name}</strong><small>{formatDuration(entry.totalTimeMs)}</small></span>
        <i style={{ width: `${Math.max(4, entry.share * 100)}%` }} />
      </li>
    ))}
  </ol>
);

const Timeline: React.FC<{ points: ReviewTimelinePoint[] }> = ({ points }) => {
  const max = Math.max(1, ...points.map(point => point.totalTimeMs));

  return (
    <div className="annual-review-timeline">
      {points.map(point => (
        <div key={point.label} title={`${point.label}: ${formatDuration(point.totalTimeMs)}`}>
          <i style={{ height: `${Math.max(3, point.totalTimeMs / max * 100)}%` }} />
          <span>{point.label}</span>
        </div>
      ))}
    </div>
  );
};

const Distribution: React.FC<{ title: string; entries: ReviewNamedTotal[] }> = ({ title, entries }) => (
  <div className="annual-review-distribution">
    <h3>{title}</h3>
    {entries.slice(0, 4).map(entry => (
      <div key={entry.name}>
        <span>{entry.name}</span>
        <b>{Math.round(entry.share * 100)}%</b>
        <i><em style={{ width: `${entry.share * 100}%` }} /></i>
      </div>
    ))}
  </div>
);

function buildTelemetryItems(data: AnnualReviewData, locale: string): string[][] {
  const items: string[][] = [];
  const telemetry = data.telemetry;
  if (telemetry.averageStartupLatencyMs !== null) items.push(['Average startup', `${(telemetry.averageStartupLatencyMs / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`]);
  if (telemetry.bufferingDurationMs !== null) items.push(['Buffering', formatDuration(telemetry.bufferingDurationMs)]);
  if (telemetry.stallCount !== null) items.push(['Stalls', telemetry.stallCount.toLocaleString(locale)]);
  if (telemetry.failureCount !== null) items.push(['Failed sessions', telemetry.failureCount.toLocaleString(locale)]);
  return items;
}
