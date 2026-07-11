import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseInitialPlaybackEngine,
  clearRememberedPlaybackEngines,
  DATA_WITHOUT_FRAME_TIMEOUT_MS,
  evaluatePlaybackStartup,
  FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS,
  FAST_NO_DATA_TIMEOUT_MS,
  forgetRememberedPlaybackEngine,
  getRememberedPlaybackEngine,
  nextAdaptiveBufferState,
  nextPlaybackStartupCheckDelay,
  NO_DATA_TIMEOUT_MS,
  PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS,
  PROXY_NO_DATA_TIMEOUT_MS,
  rememberSuccessfulPlaybackEngine
} from '../src/services/playbackStartupPolicy';
import type { PlaybackEngine } from '../src/services/playbackStartupPolicy';

test('waits up to eight seconds when no stream data arrives', () => {
  const base = { attemptStartedAt: 1000, firstDataAt: null, hasFirstFrame: false };
  assert.equal(evaluatePlaybackStartup({ ...base, now: 1000 + NO_DATA_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...base, now: 1000 + NO_DATA_TIMEOUT_MS }), 'network-error');
});

test('falls back three seconds after data arrives without a first frame', () => {
  const base = { attemptStartedAt: 1000, firstDataAt: 2500, hasFirstFrame: false };
  assert.equal(evaluatePlaybackStartup({ ...base, now: 2500 + DATA_WITHOUT_FRAME_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...base, now: 2500 + DATA_WITHOUT_FRAME_TIMEOUT_MS }), 'fallback');
});

test('reacts immediately to explicit decoder and network failures', () => {
  const base = { now: 1000, attemptStartedAt: 1000, firstDataAt: null, hasFirstFrame: false };
  assert.equal(evaluatePlaybackStartup({ ...base, fatalFailure: 'decode' }), 'fallback');
  assert.equal(evaluatePlaybackStartup({ ...base, fatalFailure: 'network' }), 'network-error');
});

test('never times out after the first frame', () => {
  assert.equal(evaluatePlaybackStartup({
    now: 100_000,
    attemptStartedAt: 0,
    firstDataAt: 10,
    hasFirstFrame: true
  }), 'wait');
  assert.equal(nextPlaybackStartupCheckDelay({
    now: 100_000,
    attemptStartedAt: 0,
    firstDataAt: 10,
    hasFirstFrame: true
  }), null);
});

test('reschedules the deadline from the first data signal', () => {
  assert.equal(nextPlaybackStartupCheckDelay({
    now: 2000,
    attemptStartedAt: 1000,
    firstDataAt: null,
    hasFirstFrame: false
  }), 7000);
  assert.equal(nextPlaybackStartupCheckDelay({
    now: 2600,
    attemptStartedAt: 1000,
    firstDataAt: 2500,
    hasFirstFrame: false
  }), 2900);
});

test('uses shorter startup deadlines for fast fallback channels', () => {
  const noData = { attemptStartedAt: 1000, firstDataAt: null, hasFirstFrame: false, profile: 'fast-fallback' as const };
  assert.equal(evaluatePlaybackStartup({ ...noData, now: 1000 + FAST_NO_DATA_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...noData, now: 1000 + FAST_NO_DATA_TIMEOUT_MS }), 'network-error');

  const withData = { attemptStartedAt: 1000, firstDataAt: 1500, hasFirstFrame: false, profile: 'fast-fallback' as const };
  assert.equal(evaluatePlaybackStartup({ ...withData, now: 1500 + FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...withData, now: 1500 + FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS }), 'fallback');
  assert.equal(nextPlaybackStartupCheckDelay({ ...withData, now: 1600 }), FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS - 100);
});

test('keeps proxy startup alive when data arrives before the first frame', () => {
  const noData = { attemptStartedAt: 1000, firstDataAt: null, hasFirstFrame: false, profile: 'proxy' as const };
  assert.equal(PROXY_NO_DATA_TIMEOUT_MS, 8000);
  assert.equal(PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS, 12000);
  assert.equal(evaluatePlaybackStartup({ ...noData, now: 1000 + PROXY_NO_DATA_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...noData, now: 1000 + PROXY_NO_DATA_TIMEOUT_MS }), 'network-error');

  const withData = { attemptStartedAt: 1000, firstDataAt: 1500, lastDataAt: 1500, hasFirstFrame: false, profile: 'proxy' as const };
  assert.equal(evaluatePlaybackStartup({ ...withData, now: 1500 + FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...withData, now: 1500 + PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...withData, now: 1500 + PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS }), 'fallback');
});

test('keeps proxy startup alive while traffic is recent', () => {
  const trafficStillArriving = {
    attemptStartedAt: 1000,
    firstDataAt: 1500,
    lastDataAt: 13_800,
    hasFirstFrame: false,
    profile: 'proxy' as const
  };

  assert.equal(evaluatePlaybackStartup({ ...trafficStillArriving, now: 14_000 }), 'wait');
  assert.equal(nextPlaybackStartupCheckDelay({ ...trafficStillArriving, now: 14_000 }), 2800);
  assert.equal(evaluatePlaybackStartup({
    ...trafficStillArriving,
    lastDataAt: 18_800,
    now: 19_000
  }), 'fallback');
});

test('falls back when proxy traffic stalls before the first frame', () => {
  const stalledTraffic = {
    attemptStartedAt: 1000,
    firstDataAt: 1500,
    lastDataAt: 4500,
    hasFirstFrame: false,
    profile: 'proxy' as const
  };

  assert.equal(evaluatePlaybackStartup({ ...stalledTraffic, now: 1500 + PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS - 1 }), 'wait');
  assert.equal(evaluatePlaybackStartup({ ...stalledTraffic, now: 1500 + PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS }), 'fallback');
});

test('chooses hardware proxy first for high-demand MPEG-TS channels', () => {
  clearRememberedPlaybackEngines();
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/fhd.ts',
    streamKind: 'mpegts',
    qualityLabel: 'FHD'
  }), 'proxy-hardware');
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/hevc.ts',
    streamKind: 'mpegts',
    qualityLabel: 'HEVC'
  }), 'proxy-hardware');
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/uhd.ts',
    streamKind: 'mpegts',
    qualityLabel: '4K'
  }), 'proxy-hardware');
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/macos-fhd.ts',
    streamKind: 'mpegts',
    qualityLabel: 'FHD',
    platform: 'darwin'
  }), 'mpegts');
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/sd.ts',
    streamKind: 'mpegts',
    qualityLabel: 'SD'
  }), 'mpegts');
});

test('uses remembered playback engines before quality defaults', () => {
  clearRememberedPlaybackEngines();
  rememberSuccessfulPlaybackEngine('http://example.test/remembered.ts', 'proxy-copy');
  rememberSuccessfulPlaybackEngine('http://example.test/hls.m3u8', 'hls');
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/remembered.ts',
    streamKind: 'mpegts',
    qualityLabel: 'FHD'
  }), 'proxy-copy');
  assert.equal(chooseInitialPlaybackEngine({
    sourceUrl: 'http://example.test/hls.m3u8',
    streamKind: 'hls',
    qualityLabel: null
  }), 'hls');
});

test('adaptive buffer ignores startup stalls and does not require restart after playback', () => {
  assert.deepEqual(nextAdaptiveBufferState({
    now: 1000,
    currentLevel: 0,
    stallEvents: [900],
    hasStartedPlayback: false,
    windowMs: 45_000,
    threshold: 3
  }), { level: 0, stallEvents: [], increased: false });

  let state = nextAdaptiveBufferState({
    now: 1000,
    currentLevel: 0,
    stallEvents: [],
    hasStartedPlayback: true,
    windowMs: 45_000,
    threshold: 3
  });
  state = nextAdaptiveBufferState({
    now: 2000,
    currentLevel: state.level,
    stallEvents: state.stallEvents,
    hasStartedPlayback: true,
    windowMs: 45_000,
    threshold: 3
  });
  state = nextAdaptiveBufferState({
    now: 3000,
    currentLevel: state.level,
    stallEvents: state.stallEvents,
    hasStartedPlayback: true,
    windowMs: 45_000,
    threshold: 3
  });

  assert.deepEqual(state, { level: 1, stallEvents: [], increased: true });
});

test('remembers the successful engine per source URL in memory', () => {
  clearRememberedPlaybackEngines();
  rememberSuccessfulPlaybackEngine('https://example.test/one', 'proxy-copy');
  rememberSuccessfulPlaybackEngine('https://example.test/two', 'mpegts');
  assert.equal(getRememberedPlaybackEngine('https://example.test/one'), 'proxy-copy');
  assert.equal(getRememberedPlaybackEngine('https://example.test/two'), 'mpegts');
  assert.equal(getRememberedPlaybackEngine('https://example.test/missing'), null);
  assert.equal(forgetRememberedPlaybackEngine('https://example.test/one'), true);
  assert.equal(getRememberedPlaybackEngine('https://example.test/one'), null);
});

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  values() {
    return [...this.data.values()];
  }

  serialized() {
    return this.values().join('\n');
  }
}

test('persists successful playback engines by hashed source URL', () => {
  clearRememberedPlaybackEngines();
  const storage = new MemoryStorage();
  const sourceUrl = 'http://user:pass@example.test/live/secret.ts?token=abc123';

  (rememberSuccessfulPlaybackEngine as (url: string, engine: PlaybackEngine, storage: MemoryStorage) => void)(
    sourceUrl,
    'proxy-copy',
    storage
  );
  clearRememberedPlaybackEngines();

  assert.equal(
    (getRememberedPlaybackEngine as (url: string, storage: MemoryStorage) => PlaybackEngine | null)(sourceUrl, storage),
    'proxy-copy'
  );
  const input = { sourceUrl, streamKind: 'mpegts' as const, qualityLabel: 'FHD', storage };
  assert.equal(chooseInitialPlaybackEngine(input), 'proxy-copy');
  assert.doesNotMatch(storage.serialized(), /user:pass|secret\.ts|token=abc123|example\.test/);
  assert.match(storage.serialized(), /proxy-copy/);
});

test('keeps at most 128 persisted playback engine entries', () => {
  clearRememberedPlaybackEngines();
  const storage = new MemoryStorage();
  for (let index = 0; index < 130; index += 1) {
    (rememberSuccessfulPlaybackEngine as (url: string, engine: PlaybackEngine, storage: MemoryStorage) => void)(
      `https://example.test/${index}.ts`,
      index % 2 === 0 ? 'proxy-copy' : 'proxy-hardware',
      storage
    );
  }
  clearRememberedPlaybackEngines();

  const values = storage.values();
  assert.equal(values.length, 1);
  const entries = JSON.parse(values[0]) as unknown[];
  assert.equal(entries.length, 128);
  assert.equal(
    (getRememberedPlaybackEngine as (url: string, storage: MemoryStorage) => PlaybackEngine | null)('https://example.test/0.ts', storage),
    null
  );
  assert.equal(
    (getRememberedPlaybackEngine as (url: string, storage: MemoryStorage) => PlaybackEngine | null)('https://example.test/129.ts', storage),
    'proxy-hardware'
  );
});
