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
  kicker: string;
  title: string;
  content: React.ReactNode;
}

export const AnnualReview: React.FC<AnnualReviewProps> = ({ data, onExit }) => {
  const [chapterIndex, setChapterIndex] = useState(0);
  const chapterRef = useRef<HTMLElement>(null);
  const chapters = useMemo(() => buildChapters(data), [data]);
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
      aria-label={`${data.summary.period.year} Year Review`}
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
        <div className="annual-review-progress" aria-label={`Chapter ${chapterIndex + 1} of ${chapters.length}`}>
          {chapters.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={index <= chapterIndex ? 'is-complete' : ''}
              aria-label={`Go to chapter ${index + 1}: ${item.title}`}
              aria-current={index === chapterIndex ? 'step' : undefined}
              onClick={() => setChapterIndex(index)}
            />
          ))}
        </div>
        <button type="button" className="annual-review-close" onClick={onExit} aria-label="Exit Year Review">
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
        <p>{chapter.kicker}</p>
        <h2>{chapter.title}</h2>
        <div className="annual-review-content">{chapter.content}</div>
      </article>

      <footer className="annual-review-footer">
        <button type="button" onClick={goBack} disabled={chapterIndex === 0}>Previous</button>
        <span>{chapterIndex + 1} / {chapters.length}</span>
        <button type="button" onClick={goForward}>{chapterIndex === chapters.length - 1 ? 'Finish' : 'Next'}</button>
      </footer>
    </section>
  );
};

function buildChapters(data: AnnualReviewData): Chapter[] {
  const { summary } = data;
  const biggestMonth = getLargestTimelinePoint(data.monthlyTotals);
  const biggestWeekday = getLargestTimelinePoint(data.weekdayTotals);
  const peakHour = getLargestTimelinePoint(data.hourTotals);
  const chapters: Chapter[] = [
    {
      id: 'opening',
      kicker: `${summary.period.year} YEAR REVIEW`,
      title: 'You made time for live television.',
      content: (
        <div className="annual-review-hero-number">
          <strong>{formatDuration(summary.totalWatchMs)}</strong>
          <span>That is {data.equivalentDays.toFixed(1)} full days of viewing.</span>
        </div>
      )
    },
    {
      id: 'overview',
      kicker: 'THE BIG PICTURE',
      title: 'A year measured in moments.',
      content: (
        <MetricGrid items={[
          ['Sessions', summary.sessionCount.toLocaleString()],
          ['Active days', summary.activeDays.toLocaleString()],
          ['Unique channels', summary.uniqueChannelCount.toLocaleString()],
          ['Average active day', formatDuration(summary.averagePerActiveDayMs)],
          ...(summary.measuredBytes !== null ? [['Measured data', formatBytes(summary.measuredBytes)]] : [])
        ]} />
      )
    },
    {
      id: 'favourite',
      kicker: 'YOUR NUMBER ONE',
      title: summary.favoriteChannel?.name || 'Every channel had its moment.',
      content: summary.favoriteChannel ? (
        <div className="annual-review-favourite">
          <strong>{Math.round(summary.favoriteChannel.share * 100)}%</strong>
          <span>{formatDuration(summary.favoriteChannel.totalTimeMs)} across {summary.favoriteChannel.sessionCount} sessions</span>
          <small>{summary.favoriteChannel.group}</small>
        </div>
      ) : null
    },
    {
      id: 'ranking',
      kicker: 'THE TOP FIVE',
      title: 'The channels that defined your year.',
      content: <RankingList entries={data.topChannels.map(item => ({ name: item.name, totalTimeMs: item.totalTimeMs, share: item.share }))} />
    }
  ];

  if (data.topGroups.length > 0) {
    chapters.push({
      id: 'groups',
      kicker: 'YOUR CHANNEL UNIVERSE',
      title: `${data.topGroups[0].name} led the schedule.`,
      content: <RankingList entries={data.topGroups.slice(0, 5)} />
    });
  }

  chapters.push(
    {
      id: 'rhythm',
      kicker: 'YOUR RHYTHM',
      title: 'You had a prime time of your own.',
      content: <MetricGrid items={[
        ['Favourite weekday', biggestWeekday?.label || '—'],
        ['Peak hour', peakHour?.label || '—'],
        ['Biggest date', summary.busiestDayLabel || '—'],
        ['That day', formatDuration(summary.busiestDayMs)]
      ]} />
    },
    {
      id: 'timeline',
      kicker: 'MONTH BY MONTH',
      title: `${biggestMonth?.label || 'One month'} took the crown.`,
      content: <Timeline points={data.monthlyTotals} />
    },
    {
      id: 'milestones',
      kicker: 'THE MILESTONES',
      title: 'Some viewing runs stood out.',
      content: <MetricGrid items={[
        ['Longest session', formatDuration(summary.longestSessionMs)],
        ['On', summary.longestSessionChannel || '—'],
        ['Longest streak', `${data.longestStreakDays} days`],
        ['Biggest week', data.busiestWeekLabel || '—'],
        ['Week total', formatDuration(data.busiestWeekMs)]
      ]} />
    }
  );

  const telemetryItems = buildTelemetryItems(data);
  if (data.qualityTotals.length > 0 || data.streamModeTotals.length > 0 || telemetryItems.length > 0) {
    chapters.push({
      id: 'playback',
      kicker: 'BEHIND THE SCREEN',
      title: 'How your year reached the player.',
      content: (
        <div className="annual-review-playback-grid">
          {data.qualityTotals.length > 0 && <Distribution title="Quality" entries={data.qualityTotals} />}
          {data.streamModeTotals.length > 0 && <Distribution title="Playback" entries={data.streamModeTotals} />}
          {telemetryItems.length > 0 && <MetricGrid items={telemetryItems} />}
        </div>
      )
    });
  }

  chapters.push({
    id: 'finale',
    kicker: 'THAT WAS YOUR YEAR',
    title: `${summary.favoriteChannel?.name || 'Live TV'} was only part of the story.`,
    content: (
      <div className="annual-review-finale">
        <strong>{summary.period.year}</strong>
        <span>{formatDuration(summary.totalWatchMs)} · {summary.uniqueChannelCount} channels · {summary.activeDays} active days</span>
        <small>Here is to whatever comes on next.</small>
      </div>
    )
  });
  return chapters;
}

const MetricGrid: React.FC<{ items: string[][] }> = ({ items }) => (
  <div className="annual-review-metric-grid">
    {items.map(([label, value]) => (
      <div key={label}><span>{label}</span><strong>{value}</strong></div>
    ))}
  </div>
);

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

function buildTelemetryItems(data: AnnualReviewData): string[][] {
  const items: string[][] = [];
  const telemetry = data.telemetry;
  if (telemetry.averageStartupLatencyMs !== null) items.push(['Average startup', `${(telemetry.averageStartupLatencyMs / 1000).toFixed(1)}s`]);
  if (telemetry.bufferingDurationMs !== null) items.push(['Buffering', formatDuration(telemetry.bufferingDurationMs)]);
  if (telemetry.stallCount !== null) items.push(['Stalls', telemetry.stallCount.toLocaleString()]);
  if (telemetry.failureCount !== null) items.push(['Failed sessions', telemetry.failureCount.toLocaleString()]);
  return items;
}
