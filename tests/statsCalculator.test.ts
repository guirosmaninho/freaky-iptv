import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeStats } from '../src/services/statsCalculator';
import type { WatchSession } from '../src/types';

const localIso = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number
) => new Date(year, monthIndex, day, hour, minute, 0).toISOString();

describe('computeStats', () => {
  it('computes non-empty history without returning empty aggregates', () => {
    const sessions: WatchSession[] = [{
      channelId: 'rtp-1',
      channelName: 'RTP 1',
      channelGroup: 'Portugal',
      startTimeUtc: localIso(2026, 5, 15, 18, 0),
      endTimeUtc: localIso(2026, 5, 15, 18, 30),
      bytesConsumed: 0
    }];

    const stats = computeStats(sessions);
    assert.equal(stats.totalSessions, '1');
    assert.equal(stats.topChannelsAllTime[0]?.name, 'RTP 1');
  });

  it('splits watch time across crossed hours', () => {
    const stats = computeStats([
      {
        channelId: 'rtp-1',
        channelName: 'RTP 1',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 15, 10, 30),
        endTimeUtc: localIso(2026, 5, 15, 11, 30),
        bytesConsumed: 0
      }
    ]);

    assert.ok(stats.hourBars[10].fraction > 0);
    assert.ok(stats.hourBars[11].fraction > 0);
  });

  it('splits watch time across crossed days', () => {
    const stats = computeStats([
      {
        channelId: 'rtp-1',
        channelName: 'RTP 1',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 14, 23, 30),
        endTimeUtc: localIso(2026, 5, 15, 0, 30),
        bytesConsumed: 0
      }
    ]);

    assert.ok(stats.dayBars[0].totalMs > 0, 'Sunday should receive part of the session');
    assert.ok(stats.dayBars[1].totalMs > 0, 'Monday should receive part of the session');
  });

  it('aggregates variants with the same canonical channel id', () => {
    const sessions: WatchSession[] = [
      {
        channelId: 'rtp-1-hd',
        canonicalChannelId: 'rtp-1',
        channelName: 'RTP 1 HD',
        baseChannelName: 'RTP 1',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 15, 20, 0),
        endTimeUtc: localIso(2026, 5, 15, 20, 30),
        bytesConsumed: 0
      },
      {
        channelId: 'rtp-1-fhd',
        canonicalChannelId: 'rtp-1',
        channelName: 'RTP 1 Full HD',
        baseChannelName: 'RTP 1',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 15, 21, 0),
        endTimeUtc: localIso(2026, 5, 15, 21, 30),
        bytesConsumed: 0
      }
    ];

    const stats = computeStats(sessions);

    assert.equal(stats.topChannelsAllTime.length, 1);
    assert.equal(stats.topChannelsAllTime[0].name, 'RTP 1');
    assert.equal(stats.topChannelsAllTime[0].sessionCount, 2);
  });

  it('does not count legacy byte totals without a reliable source', () => {
    const stats = computeStats([
      {
        channelId: 'sport-tv',
        channelName: 'Sport TV Full HD',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 15, 18, 0),
        endTimeUtc: localIso(2026, 5, 15, 18, 1),
        bytesConsumed: 20 * 1024 * 1024 * 1024
      }
    ]);

    assert.equal(stats.totalDataFormatted, '0 MB');
    assert.equal(stats.unmeasuredSessions, '1');
  });

  it('counts byte totals when the source is measured network data', () => {
    const stats = computeStats([
      {
        channelId: 'rtp-1',
        channelName: 'RTP 1',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 15, 18, 0),
        endTimeUtc: localIso(2026, 5, 15, 18, 30),
        bytesConsumed: 1024 * 1024 * 1024,
        bytesSource: 'network'
      }
    ]);

    assert.equal(stats.totalDataFormatted, '1.00 GB');
    assert.equal(stats.unmeasuredSessions, '0');
  });

  it('counts byte totals when the source is proxy stream data', () => {
    const stats = computeStats([
      {
        channelId: 'rtp-1',
        channelName: 'RTP 1',
        channelGroup: 'Portugal',
        startTimeUtc: localIso(2026, 5, 15, 18, 0),
        endTimeUtc: localIso(2026, 5, 15, 18, 30),
        bytesConsumed: 1024 * 1024 * 512,
        bytesSource: 'proxy'
      }
    ]);

    assert.equal(stats.totalDataFormatted, '512.0 MB');
    assert.equal(stats.unmeasuredSessions, '0');
  });

  it('recovers display casing from the original channel name for legacy records', () => {
    const stats = computeStats([{
      channelId: 'sport-tv-1',
      canonicalChannelId: 'sport-tv',
      channelName: 'PT: SPORT TV 1 Full HD',
      baseChannelName: 'sport tv 1',
      channelGroup: 'Sports',
      startTimeUtc: localIso(2026, 5, 15, 18, 0),
      endTimeUtc: localIso(2026, 5, 15, 19, 0),
      bytesConsumed: 0
    }], { now: new Date(2026, 5, 15, 20, 0) });

    assert.equal(stats.longestSessionChannel, 'SPORT TV 1');
    assert.equal(stats.topChannelsAllTime[0]?.name, 'SPORT TV 1');
  });

  it('clips every aggregate to an explicit date range', () => {
    const stats = computeStats([
      {
        channelId: 'inside',
        channelName: 'Inside HD',
        channelGroup: 'Test',
        startTimeUtc: localIso(2026, 5, 15, 10, 0),
        endTimeUtc: localIso(2026, 5, 15, 11, 0),
        bytesConsumed: 0
      },
      {
        channelId: 'outside',
        channelName: 'Outside HD',
        channelGroup: 'Test',
        startTimeUtc: localIso(2025, 0, 1, 10, 0),
        endTimeUtc: localIso(2025, 0, 1, 12, 0),
        bytesConsumed: 0
      }
    ], {
      rangeStart: new Date(2026, 5, 15, 10, 30),
      rangeEnd: new Date(2026, 5, 15, 10, 45),
      now: new Date(2026, 5, 15, 20, 0)
    });

    assert.equal(stats.totalSessions, '1');
    assert.equal(stats.totalWatchTime, '15m');
    assert.equal(stats.uniqueChannelsWatched, '1');
    assert.equal(stats.longestSession, '15m');
  });

  it('anchors the heatmap to an explicit historical range', () => {
    const stats = computeStats([], {
      rangeStart: new Date(2023, 0, 1),
      rangeEnd: new Date(2024, 0, 1),
      now: new Date(2026, 5, 15)
    });

    assert.match(stats.heatmapStartMonth, /2022|2023/);
    assert.match(stats.heatmapEndMonth, /2023|2024/);
  });

  it('builds the sharing card from the rolling last 365 local days', () => {
    const now = new Date(2026, 5, 15, 12, 0);
    const stats = computeStats([
      {
        channelId: 'recent',
        channelName: 'Recent FHD',
        channelGroup: 'Test',
        startTimeUtc: localIso(2026, 5, 14, 10, 0),
        endTimeUtc: localIso(2026, 5, 14, 11, 0),
        bytesConsumed: 0
      },
      {
        channelId: 'old',
        channelName: 'Old HD',
        channelGroup: 'Test',
        startTimeUtc: localIso(2025, 5, 14, 10, 0),
        endTimeUtc: localIso(2025, 5, 14, 12, 0),
        bytesConsumed: 0
      }
    ], { now });

    assert.equal(stats.shareCard.totalSessions, '1');
    assert.equal(stats.shareCard.totalWatchTime, '1h 0m');
    assert.equal(stats.shareCard.heatmapCells.length, 365);
  });
});
