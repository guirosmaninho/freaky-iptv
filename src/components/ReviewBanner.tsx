import React, { memo } from 'react';
import type { AvailableReview } from '../types';
import { formatBytes, formatDuration } from '../services/statsCalculator';

interface ReviewBannerProps {
  review: AvailableReview;
  isOpened: boolean;
  onOpen: (review: AvailableReview) => void;
  onDismiss: (review: AvailableReview) => void;
}

const LABELS = {
  weekly: { eyebrow: 'Weekly Review', title: 'Your week in television' },
  monthly: { eyebrow: 'Monthly Review', title: 'A month worth replaying' },
  annual: { eyebrow: 'Year Review', title: 'Your viewing year is ready' }
} as const;

const ReviewBannerComponent: React.FC<ReviewBannerProps> = ({ review, isOpened, onOpen, onDismiss }) => {
  const { summary } = review;
  const labels = LABELS[review.kind];
  const metrics = [
    { label: 'Watch time', value: formatDuration(summary.totalWatchMs) },
    { label: 'Favourite channel', value: summary.favoriteChannel?.name || 'No favourite yet' },
    { label: 'Biggest day', value: summary.busiestDayLabel || 'No active day' }
  ];

  if (review.kind === 'monthly') {
    metrics.push(
      { label: 'Sessions', value: summary.sessionCount.toLocaleString() },
      { label: 'Channels', value: summary.uniqueChannelCount.toLocaleString() },
      { label: 'Active days', value: summary.activeDays.toLocaleString() },
      { label: 'Longest session', value: formatDuration(summary.longestSessionMs) }
    );
    if (summary.measuredBytes !== null) metrics.push({ label: 'Measured data', value: formatBytes(summary.measuredBytes) });
  }

  return (
    <div className={`review-banner review-banner--${review.kind} ${isOpened ? 'review-banner--opened' : 'review-banner--pending'}`}>
      <button
        type="button"
        className="review-banner-open"
        onClick={() => onOpen(review)}
        aria-label={`Open ${labels.eyebrow}: ${review.period.label}`}
      >
        <span className="review-banner-copy">
          <span className="review-banner-eyebrow">{labels.eyebrow} · {review.period.label}</span>
          <strong>{labels.title}</strong>
          <span>{isOpened ? 'Open again' : 'Open your review'} <span aria-hidden="true">→</span></span>
        </span>

        <span className={`review-banner-metrics ${review.kind === 'monthly' ? 'review-banner-metrics--wide' : ''}`}>
          {metrics.map(metric => (
            <span className="review-banner-metric" key={metric.label}>
              <small>{metric.label}</small>
              <b title={metric.value}>{metric.value}</b>
            </span>
          ))}
        </span>
      </button>
      <button
        type="button"
        className="review-banner-dismiss"
        onClick={() => onDismiss(review)}
        aria-label={`Dismiss ${labels.eyebrow}: ${review.period.label}`}
        title="Dismiss review"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
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
    </div>
  );
};

export const ReviewBanner = memo(ReviewBannerComponent);
