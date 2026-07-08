import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeAvailableReviews, getDisplayReview, normalizeOpenedReviewIds } from '../src/services/reviewCalculator';
import type { WatchSession } from '../src/types';

const localIso = (year: number, monthIndex: number, day: number, hour = 12, minute = 0) =>
  new Date(year, monthIndex, day, hour, minute, 0).toISOString();

const session = (
  start: string,
  end: string,
  overrides: Partial<WatchSession> = {}
): WatchSession => ({
  channelId: 'rtp-1',
  canonicalChannelId: 'rtp-1',
  channelName: 'RTP 1 Full HD',
  baseChannelName: 'RTP 1',
  channelGroup: 'Portugal',
  startTimeUtc: start,
  endTimeUtc: end,
  bytesConsumed: 0,
  ...overrides
});

describe('computeAvailableReviews', () => {
  it('uses the complete previous Monday-to-Sunday week', () => {
    const reviews = computeAvailableReviews([
      session(localIso(2026, 5, 9, 20), localIso(2026, 5, 9, 21)),
      session(localIso(2026, 5, 16, 20), localIso(2026, 5, 16, 22), { channelId: 'late' })
    ], new Date(2026, 5, 21, 10));

    assert.deepEqual(reviews.map(review => review.kind), ['weekly', 'weekly']);
    assert.equal(reviews[0].summary.totalWatchMs, 2 * 60 * 60 * 1000);
    assert.match(reviews[0].period.label, /Jun 15/);
    assert.match(reviews[0].period.label, /Jun 21/);
    assert.equal(reviews[1].summary.totalWatchMs, 60 * 60 * 1000);
    assert.match(reviews[1].period.label, /Jun 8/);
    assert.match(reviews[1].period.label, /Jun 14/);
  });

  it('orders monthly before weekly when the first day is Sunday', () => {
    const reviews = computeAvailableReviews([
      session(localIso(2027, 6, 10, 20), localIso(2027, 6, 10, 21)),
      session(localIso(2027, 6, 23, 20), localIso(2027, 6, 23, 21))
    ], new Date(2027, 7, 1, 9));

    assert.deepEqual(reviews.map(review => review.kind), ['monthly', 'weekly']);
    assert.equal(getDisplayReview(reviews, [reviews[0].period.key])?.kind, 'weekly');
  });

  it('orders annual, monthly and weekly in one slot during an overlapping season', () => {
    const reviews = computeAvailableReviews([
      session(localIso(2022, 11, 10, 20), localIso(2022, 11, 10, 21)),
      session(localIso(2022, 11, 15, 20), localIso(2022, 11, 15, 21)),
      session(localIso(2022, 11, 19, 20), localIso(2022, 11, 19, 21))
    ], new Date(2023, 0, 1, 9));

    assert.deepEqual(reviews.map(review => review.kind), ['annual', 'monthly', 'weekly']);
    assert.equal(getDisplayReview(reviews, [reviews[0].period.key])?.kind, 'monthly');
    assert.equal(getDisplayReview(reviews, reviews.slice(0, 2).map(review => review.period.key))?.kind, 'weekly');
  });

  it('includes leap day in the previous calendar month', () => {
    const reviews = computeAvailableReviews([
      session(localIso(2024, 1, 29, 20), localIso(2024, 1, 29, 21))
    ], new Date(2024, 2, 1, 9));

    assert.deepEqual(reviews.map(review => review.kind), ['monthly']);
    assert.equal(reviews[0].summary.busiestDayLabel, 'Thu, Feb 29');
  });

  it('freezes the annual period at December 19 across the season', () => {
    const history = [
      session(localIso(2026, 11, 19, 18), localIso(2026, 11, 19, 20)),
      session(localIso(2026, 11, 20, 18), localIso(2026, 11, 20, 21), { channelId: 'excluded' })
    ];

    const december = computeAvailableReviews(history, new Date(2026, 11, 20, 9))[0];
    const january = computeAvailableReviews(history, new Date(2027, 0, 5, 9))[0];

    assert.equal(december.kind, 'annual');
    assert.equal(january.kind, 'annual');
    assert.equal(december.period.key, 'annual:2026');
    assert.equal(january.period.key, 'annual:2026');
    assert.equal(december.summary.totalWatchMs, 2 * 60 * 60 * 1000);
    assert.equal(january.summary.totalWatchMs, december.summary.totalWatchMs);
  });

  it('does not expose reviews without positive watch time', () => {
    assert.deepEqual(computeAvailableReviews([], new Date(2027, 7, 1, 9)), []);
  });

  it('splits sessions at midnight and aggregates canonical variants and measured bytes', () => {
    const reviews = computeAvailableReviews([
      session(localIso(2027, 6, 31, 23, 30), localIso(2027, 7, 1, 0, 30), {
        channelId: 'rtp-hd',
        bytesConsumed: 1024 * 1024 * 1024,
        bytesSource: 'network'
      }),
      session(localIso(2027, 6, 30, 20), localIso(2027, 6, 30, 21), {
        channelId: 'rtp-fhd'
      })
    ], new Date(2027, 7, 1, 9));

    const monthly = reviews.find(review => review.kind === 'monthly');
    assert.ok(monthly);
    assert.equal(monthly.summary.favoriteChannel?.name, 'RTP 1');
    assert.equal(monthly.summary.favoriteChannel?.sessionCount, 2);
    assert.equal(monthly.summary.measuredBytes, 512 * 1024 * 1024);
    assert.equal(monthly.summary.activeDays, 2);
  });

  it('builds annual rankings, streaks, timeline and available telemetry', () => {
    const history = [
      session(localIso(2026, 0, 1, 18), localIso(2026, 0, 1, 20), {
        playingDurationMs: 2 * 60 * 60 * 1000,
        startupLatencyMs: 1200,
        bufferingDurationMs: 3000,
        stallCount: 2,
        stallDurationMs: 1500,
        qualityLabel: 'FHD',
        streamMode: 'copy'
      }),
      session(localIso(2026, 0, 2, 18), localIso(2026, 0, 2, 19), {
        qualityLabel: 'FHD',
        streamMode: 'copy',
        failureReason: 'network'
      }),
      session(localIso(2026, 1, 5, 12), localIso(2026, 1, 5, 13), {
        channelId: 'sic',
        canonicalChannelId: 'sic',
        channelName: 'SIC',
        baseChannelName: 'SIC',
        channelGroup: 'Entertainment',
        qualityLabel: 'HD',
        streamMode: 'hardware'
      })
    ];

    const annual = computeAvailableReviews(history, new Date(2026, 11, 20, 9))[0].annualData;
    assert.ok(annual);
    assert.equal(annual.topChannels[0].name, 'RTP 1');
    assert.equal(annual.topGroups[0].name, 'Portugal');
    assert.equal(annual.longestStreakDays, 2);
    assert.equal(annual.monthlyTotals.find(item => item.label === 'Jan')?.totalTimeMs, 3 * 60 * 60 * 1000);
    assert.equal(annual.qualityTotals[0].name, 'FHD');
    assert.equal(annual.telemetry.averageStartupLatencyMs, 1200);
    assert.equal(annual.telemetry.failureCount, 1);
  });

  it('uses custom quality mappings when displaying annual channel names', () => {
    const history = [session(localIso(2026, 0, 1, 18), localIso(2026, 0, 1, 19), {
      channelId: 'sport-tv',
      canonicalChannelId: 'sport-tv',
      channelName: 'SPORT TV PREMIUM',
      baseChannelName: 'SPORT TV',
      channelGroup: 'Sports'
    })];

    const annual = computeAvailableReviews(
      history,
      new Date(2026, 11, 20, 9),
      { FHD: 'premium' }
    )[0].annualData;
    assert.equal(annual?.topChannels[0].name, 'SPORT TV');
  });
});

describe('normalizeOpenedReviewIds', () => {
  it('deduplicates, validates and keeps the newest 128 ids', () => {
    const ids = Array.from({ length: 140 }, (_, index) => `weekly:2026-W${index}`);
    const normalized = normalizeOpenedReviewIds(['', 'invalid id', ...ids, ids[139]]);
    assert.equal(normalized.length, 128);
    assert.equal(normalized.at(-1), ids[139]);
    assert.equal(new Set(normalized).size, normalized.length);
  });
});
