import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { WatchSession } from '../src/types';

type HistoryStorageModule = {
  normalizeHistoryItem: (item: Record<string, unknown>) => WatchSession;
  normalizeHistoryList: (items: unknown[]) => { cleaned: WatchSession[]; dirty: boolean };
};

const requireFromProject = createRequire(join(process.cwd(), 'package.json'));
const { normalizeHistoryItem, normalizeHistoryList } = requireFromProject('./historyStorage.cjs') as HistoryStorageModule;

describe('history storage normalization', () => {
  it('preserves all telemetry fields from current sessions', () => {
    const session: WatchSession = {
      sessionId: 'session-1',
      channelId: 'channel-1',
      canonicalChannelId: 'canonical-1',
      channelName: 'Channel 1 Full HD',
      baseChannelName: 'Channel 1',
      channelGroup: 'Portugal',
      selectedAtUtc: '2026-06-18T10:00:00.000Z',
      playbackStartedAtUtc: '2026-06-18T10:00:02.000Z',
      startTimeUtc: '2026-06-18T10:00:02.000Z',
      endTimeUtc: '2026-06-18T10:10:02.000Z',
      bytesConsumed: 123456,
      bytesSource: 'proxy',
      playingDurationMs: 600000,
      bufferingDurationMs: 1200,
      startupLatencyMs: 2000,
      stallCount: 2,
      stallDurationMs: 1200,
      failureReason: '',
      streamMode: 'hardware',
      qualityLabel: 'FHD'
    };

    assert.deepEqual(normalizeHistoryItem(session as unknown as Record<string, unknown>), session);
  });

  it('maps legacy PascalCase sessions without dropping their duration', () => {
    const normalized = normalizeHistoryItem({
      ChannelId: 'legacy-channel',
      ChannelName: 'Legacy Channel',
      ChannelGroup: 'Legacy',
      StartTimeUtc: '2026-06-17T20:00:00.000Z',
      EndTimeUtc: '2026-06-17T20:05:00.000Z',
      PlayingDurationMs: 300000,
      BytesConsumed: 10
    });

    assert.equal(normalized.channelId, 'legacy-channel');
    assert.equal(normalized.playingDurationMs, 300000);
    assert.equal(normalized.bytesConsumed, 10);
  });

  it('keeps valid entries when malformed and mixed-schema entries are present', () => {
    const result = normalizeHistoryList([
      {
        channelId: 'valid-channel',
        channelName: 'Valid Channel',
        startTimeUtc: '2026-06-18T12:00:00.000Z',
        endTimeUtc: '2026-06-18T12:05:00.000Z'
      },
      {
        channelId: null,
        ChannelId: 'legacy-fallback-channel',
        startTimeUtc: null,
        StartTimeUtc: '2026-06-18T13:00:00.000Z',
        EndTimeUtc: '2026-06-18T13:05:00.000Z'
      },
      {
        channelId: 'malformed-channel',
        startTimeUtc: 12345
      }
    ]);

    assert.equal(result.dirty, true);
    assert.deepEqual(result.cleaned.map(session => session.channelId), [
      'valid-channel',
      'legacy-fallback-channel'
    ]);
    assert.equal(result.cleaned[1].startTimeUtc, '2026-06-18T13:00:00.000Z');
  });
});
