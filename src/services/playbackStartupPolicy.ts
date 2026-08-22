import type { AdaptiveBufferLevel } from '../types';
import { sha256Short } from './utils';

export type PlaybackEngine = 'native' | 'hls' | 'mpegts' | 'proxy-copy' | 'proxy-hardware';

export type PlaybackStartupAction = 'wait' | 'fallback' | 'network-error';
export type PlaybackStartupProfile = 'default' | 'fast-fallback' | 'proxy';
export type PlaybackStreamKind = 'native' | 'hls' | 'mpegts';

export const DATA_WITHOUT_FRAME_TIMEOUT_MS = 3000;
export const NO_DATA_TIMEOUT_MS = 8000;
export const FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS = 1200;
export const FAST_NO_DATA_TIMEOUT_MS = 1800;
export const PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS = 12000;
export const PROXY_NO_DATA_TIMEOUT_MS = 8000;
export const PROXY_RECENT_DATA_GRACE_MS = 3000;
export const PROXY_MAX_STARTUP_TIMEOUT_MS = 18000;
const REMEMBERED_PLAYBACK_ENGINES_STORAGE_KEY = 'freaky-playback-engine-cache-v1';
const MAX_REMEMBERED_PLAYBACK_ENGINES = 128;

export interface PlaybackStartupSnapshot {
  now: number;
  attemptStartedAt: number;
  firstDataAt: number | null;
  lastDataAt?: number | null;
  hasFirstFrame: boolean;
  fatalFailure?: 'decode' | 'network' | null;
  profile?: PlaybackStartupProfile;
}

export interface PlaybackEnginePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface InitialPlaybackEngineInput {
  sourceUrl: string;
  streamKind: PlaybackStreamKind;
  qualityLabel?: string | null;
  platform?: string;
  storage?: PlaybackEnginePreferenceStorage | null;
}

export interface AdaptiveBufferSnapshot {
  now: number;
  currentLevel: AdaptiveBufferLevel;
  stallEvents: number[];
  hasStartedPlayback: boolean;
  windowMs: number;
  threshold: number;
}

export interface AdaptiveBufferState {
  level: AdaptiveBufferLevel;
  stallEvents: number[];
  increased: boolean;
}

const startupTimeouts = (profile: PlaybackStartupProfile = 'default') => {
  if (profile === 'fast-fallback') {
    return { dataWithoutFrameMs: FAST_DATA_WITHOUT_FRAME_TIMEOUT_MS, noDataMs: FAST_NO_DATA_TIMEOUT_MS };
  }
  if (profile === 'proxy') {
    return { dataWithoutFrameMs: PROXY_DATA_WITHOUT_FRAME_TIMEOUT_MS, noDataMs: PROXY_NO_DATA_TIMEOUT_MS };
  }
  return { dataWithoutFrameMs: DATA_WITHOUT_FRAME_TIMEOUT_MS, noDataMs: NO_DATA_TIMEOUT_MS };
};

export const isHighDemandPlaybackQuality = (qualityLabel?: string | null) => {
  const normalized = String(qualityLabel || '').trim().toUpperCase();
  return normalized === 'FHD' || normalized === 'HEVC' || normalized === '4K';
};

export const chooseInitialPlaybackEngine = ({
  sourceUrl,
  streamKind,
  qualityLabel = null,
  platform = 'win32',
  storage = undefined
}: InitialPlaybackEngineInput): PlaybackEngine => {
  const rememberedEngine = getRememberedPlaybackEngine(sourceUrl, storage);
  if (rememberedEngine) return rememberedEngine;
  if (streamKind === 'hls') return 'hls';
  if (streamKind === 'native') return 'native';
  // VideoToolbox is a valuable fallback on macOS, but opening a fresh encoder
  // is slower than feeding a normal H.264 transport stream directly to MSE.
  // Start with the lightweight path and retain copy -> VideoToolbox -> software
  // fallback if the stream needs conversion.
  return isHighDemandPlaybackQuality(qualityLabel) && platform !== 'darwin'
    ? 'proxy-hardware'
    : 'mpegts';
};

export const nextAdaptiveBufferState = ({
  now,
  currentLevel,
  stallEvents,
  hasStartedPlayback,
  windowMs,
  threshold
}: AdaptiveBufferSnapshot): AdaptiveBufferState => {
  if (!hasStartedPlayback) {
    return { level: currentLevel, stallEvents: [], increased: false };
  }

  const nextStallEvents = [...stallEvents, now]
    .filter(timestamp => now - timestamp <= windowMs);
  if (nextStallEvents.length < threshold || currentLevel >= 2) {
    return { level: currentLevel, stallEvents: nextStallEvents, increased: false };
  }

  return {
    level: (currentLevel + 1) as AdaptiveBufferLevel,
    stallEvents: [],
    increased: true
  };
};

export const adaptiveEscalationThreshold = (level: AdaptiveBufferLevel): { windowMs: number; threshold: number } => (
  // Level 0 ramps up quickly: two stalls in half a minute already mean the
  // default target is too tight for this source. Higher levels need stronger
  // evidence before trading more latency for stability.
  level === 0 ? { windowMs: 30_000, threshold: 2 } : { windowMs: 45_000, threshold: 3 }
);

export interface MpegTsBufferProfile {
  stashInitialSize: number;
  liveSyncTargetLatency: number;
  liveSyncMaxLatency: number;
  liveSyncPlaybackRate: number;
  liveBufferLatencyMaxLatency: number;
  liveBufferLatencyMinRemain: number;
}

export const MPEGTS_BUFFER_PROFILES: Record<AdaptiveBufferLevel, MpegTsBufferProfile> = {
  // stashInitialSize: internal read-ahead buffer for mpegts.js.
  // FHD streams run at 6-8 Mbps, so 384 KB ~= 0.4 s is too small to decode
  // H.264 High Profile without artefacts. 1 MB ~= 1.3 s gives a stable margin.
  // liveSync holds the live target with a gentle playback-rate catch-up;
  // latency chasing stays armed only as a catastrophic backstop so recovering
  // from a stall never hard-seeks forward into the next stall.
  0: {
    stashInitialSize: 1024 * 1024,
    liveSyncTargetLatency: 5,
    liveSyncMaxLatency: 6.5,
    liveSyncPlaybackRate: 1.1,
    liveBufferLatencyMaxLatency: 16,
    liveBufferLatencyMinRemain: 5
  },
  1: {
    stashInitialSize: 2 * 1024 * 1024,
    liveSyncTargetLatency: 8,
    liveSyncMaxLatency: 10,
    liveSyncPlaybackRate: 1.1,
    liveBufferLatencyMaxLatency: 22,
    liveBufferLatencyMinRemain: 7
  },
  2: {
    stashInitialSize: 4 * 1024 * 1024,
    liveSyncTargetLatency: 12,
    liveSyncMaxLatency: 14.5,
    liveSyncPlaybackRate: 1.1,
    liveBufferLatencyMaxLatency: 30,
    liveBufferLatencyMinRemain: 10
  }
};

export interface HlsBufferProfile {
  liveSyncDuration: number;
  liveMaxLatencyDuration: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
}

export const HLS_BUFFER_PROFILES: Record<AdaptiveBufferLevel, HlsBufferProfile> = {
  0: { liveSyncDuration: 6, liveMaxLatencyDuration: 30, maxBufferLength: 30, maxMaxBufferLength: 45 },
  1: { liveSyncDuration: 10, liveMaxLatencyDuration: 40, maxBufferLength: 45, maxMaxBufferLength: 60 },
  2: { liveSyncDuration: 14, liveMaxLatencyDuration: 55, maxBufferLength: 60, maxMaxBufferLength: 75 }
};

// hls.js never applies playback-rate catch-up when this is exactly 1; anything
// above 1 lets it drift back to the live target at a gentle 1.1x instead of
// hard-seeking at liveMaxLatencyDuration.
export const HLS_LIVE_CATCH_UP_PLAYBACK_RATE = 1.1;

// After a stall the stream is at its most fragile: briefly accept a little
// more latency, then let rate catch-up hand it back smoothly.
export const POST_STALL_TARGET_BOOST_SECONDS = 2.5;
export const POST_STALL_BOOST_MS = 45_000;

export const buildMpegTsBufferConfig = (level: AdaptiveBufferLevel) => {
  const profile = MPEGTS_BUFFER_PROFILES[level];
  return {
    enableStashBuffer: true,
    stashInitialSize: profile.stashInitialSize,
    liveSync: true,
    liveSyncTargetLatency: profile.liveSyncTargetLatency,
    liveSyncMaxLatency: profile.liveSyncMaxLatency,
    liveSyncPlaybackRate: profile.liveSyncPlaybackRate,
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: profile.liveBufferLatencyMaxLatency,
    liveBufferLatencyMinRemain: profile.liveBufferLatencyMinRemain
  };
};

export const buildHlsBufferConfig = (level: AdaptiveBufferLevel) => {
  const profile = HLS_BUFFER_PROFILES[level];
  return {
    liveSyncDuration: profile.liveSyncDuration,
    liveMaxLatencyDuration: profile.liveMaxLatencyDuration,
    maxLiveSyncPlaybackRate: HLS_LIVE_CATCH_UP_PLAYBACK_RATE,
    lowLatencyMode: true,
    maxBufferLength: profile.maxBufferLength,
    maxMaxBufferLength: profile.maxMaxBufferLength
  };
};

// Start near the top of the HLS ladder: sport needs a sharp picture from the
// first second, and IPTV relays are usually far faster than the stream itself.
export const HLS_QUALITY_CONFIG = {
  testBandwidth: false,
  abrEwmaDefaultEstimate: 8_000_000,
  abrBandWidthUpFactor: 0.85
} as const;

export interface HlsRuntimeBufferConfig {
  config: {
    liveSyncDuration?: number;
    liveMaxLatencyDuration?: number;
    maxBufferLength?: number;
    maxMaxBufferLength?: number;
    maxLiveSyncPlaybackRate?: number;
  };
}

// hls.js controllers re-read hls.config on every tick, so mutating it applies
// a new latency target to a running stream.
export const applyHlsRuntimeProfile = (
  hls: HlsRuntimeBufferConfig | null,
  level: AdaptiveBufferLevel,
  targetBoostSeconds = 0
) => {
  if (!hls?.config) return;
  const profile = HLS_BUFFER_PROFILES[level];
  hls.config.liveSyncDuration = profile.liveSyncDuration + targetBoostSeconds;
  hls.config.liveMaxLatencyDuration = profile.liveMaxLatencyDuration;
  hls.config.maxBufferLength = profile.maxBufferLength;
  hls.config.maxMaxBufferLength = profile.maxMaxBufferLength;
  hls.config.maxLiveSyncPlaybackRate = HLS_LIVE_CATCH_UP_PLAYBACK_RATE;
};

interface MpegTsRuntimeConfig {
  liveSyncTargetLatency?: number;
  liveSyncMaxLatency?: number;
  liveBufferLatencyMaxLatency?: number;
  liveBufferLatencyMinRemain?: number;
}

// mpegts.js copies the config passed to createPlayer, but its latency
// controllers re-read the player's internal config object continuously. That
// object is not part of the public API, so reach in defensively: if internals
// ever change, this returns false and the per-URL level memory still applies
// the profile on the next tuning.
export const applyMpegTsRuntimeProfile = (
  player: unknown,
  level: AdaptiveBufferLevel,
  targetBoostSeconds = 0
): boolean => {
  try {
    const config = (player as { _player_engine?: { _config?: MpegTsRuntimeConfig } } | null)?._player_engine?._config;
    if (!config || typeof config.liveSyncTargetLatency !== 'number') return false;
    const profile = MPEGTS_BUFFER_PROFILES[level];
    config.liveSyncTargetLatency = profile.liveSyncTargetLatency + targetBoostSeconds;
    config.liveSyncMaxLatency = profile.liveSyncMaxLatency + targetBoostSeconds;
    config.liveBufferLatencyMaxLatency = profile.liveBufferLatencyMaxLatency;
    config.liveBufferLatencyMinRemain = profile.liveBufferLatencyMinRemain;
    return true;
  } catch {
    return false;
  }
};

export const evaluatePlaybackStartup = ({
  now,
  attemptStartedAt,
  firstDataAt,
  lastDataAt = null,
  hasFirstFrame,
  fatalFailure = null,
  profile = 'default'
}: PlaybackStartupSnapshot): PlaybackStartupAction => {
  if (hasFirstFrame) return 'wait';
  if (fatalFailure === 'decode') return 'fallback';
  if (fatalFailure === 'network') return 'network-error';
  const { dataWithoutFrameMs, noDataMs } = startupTimeouts(profile);
  if (profile === 'proxy') {
    if (firstDataAt === null) {
      return now - attemptStartedAt >= noDataMs ? 'network-error' : 'wait';
    }
    if (now - attemptStartedAt >= PROXY_MAX_STARTUP_TIMEOUT_MS) {
      return 'fallback';
    }
    const mostRecentDataAt = lastDataAt ?? firstDataAt;
    if (now - mostRecentDataAt <= PROXY_RECENT_DATA_GRACE_MS && now - firstDataAt >= dataWithoutFrameMs) {
      return 'wait';
    }
    return now - firstDataAt >= dataWithoutFrameMs ? 'fallback' : 'wait';
  }
  if (firstDataAt !== null) {
    return now - firstDataAt >= dataWithoutFrameMs ? 'fallback' : 'wait';
  }
  return now - attemptStartedAt >= noDataMs ? 'network-error' : 'wait';
};

export const nextPlaybackStartupCheckDelay = ({
  now,
  attemptStartedAt,
  firstDataAt,
  lastDataAt = null,
  hasFirstFrame,
  profile = 'default'
}: PlaybackStartupSnapshot): number | null => {
  if (hasFirstFrame) return null;
  const { dataWithoutFrameMs, noDataMs } = startupTimeouts(profile);
  let deadline: number;
  if (profile === 'proxy' && firstDataAt !== null) {
    const dataDeadline = firstDataAt + dataWithoutFrameMs;
    const recentDataDeadline = (lastDataAt ?? firstDataAt) + PROXY_RECENT_DATA_GRACE_MS;
    const maxDeadline = attemptStartedAt + PROXY_MAX_STARTUP_TIMEOUT_MS;
    deadline = Math.min(maxDeadline, Math.max(dataDeadline, recentDataDeadline));
  } else {
    deadline = firstDataAt === null
      ? attemptStartedAt + noDataMs
      : firstDataAt + dataWithoutFrameMs;
  }
  return Math.max(0, deadline - now);
};

interface StoredPlaybackEngine {
  urlHash: string;
  engine: PlaybackEngine;
  rememberedAt: number;
}

const successfulEngineByUrlHash = new Map<string, PlaybackEngine>();

const isPlaybackEngine = (value: unknown): value is PlaybackEngine => (
  value === 'native' ||
  value === 'hls' ||
  value === 'mpegts' ||
  value === 'proxy-copy' ||
  value === 'proxy-hardware'
);

const resolvePlaybackEngineStorage = (
  storage?: PlaybackEnginePreferenceStorage | null
): PlaybackEnginePreferenceStorage | null => {
  if (storage !== undefined) return storage;
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return null;
  return globalThis.localStorage as PlaybackEnginePreferenceStorage;
};

const playbackEngineUrlHash = (url: string) => sha256Short(String(url));

const readStoredPlaybackEngines = (storage?: PlaybackEnginePreferenceStorage | null): StoredPlaybackEngine[] => {
  const resolvedStorage = resolvePlaybackEngineStorage(storage);
  if (!resolvedStorage) return [];
  try {
    const raw = resolvedStorage.getItem(REMEMBERED_PLAYBACK_ENGINES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is StoredPlaybackEngine => (
        entry &&
        typeof entry === 'object' &&
        typeof entry.urlHash === 'string' &&
        /^[a-f0-9]{16}$/.test(entry.urlHash) &&
        isPlaybackEngine(entry.engine) &&
        Number.isFinite(entry.rememberedAt)
      ))
      .slice(-MAX_REMEMBERED_PLAYBACK_ENGINES);
  } catch {
    return [];
  }
};

const writeStoredPlaybackEngines = (
  entries: StoredPlaybackEngine[],
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const resolvedStorage = resolvePlaybackEngineStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(
      REMEMBERED_PLAYBACK_ENGINES_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_REMEMBERED_PLAYBACK_ENGINES))
    );
  } catch {
    // Remembering a playback engine is an optimisation; playback must not fail if storage is unavailable.
  }
};

export const rememberSuccessfulPlaybackEngine = (
  url: string,
  engine: PlaybackEngine,
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const urlHash = playbackEngineUrlHash(url);
  successfulEngineByUrlHash.set(urlHash, engine);
  const stored = readStoredPlaybackEngines(storage)
    .filter(entry => entry.urlHash !== urlHash);
  stored.push({ urlHash, engine, rememberedAt: Date.now() });
  writeStoredPlaybackEngines(stored, storage);
};

export const getRememberedPlaybackEngine = (
  url: string,
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const urlHash = playbackEngineUrlHash(url);
  const memoryEngine = successfulEngineByUrlHash.get(urlHash);
  if (memoryEngine) return memoryEngine;
  const storedEngine = readStoredPlaybackEngines(storage).find(entry => entry.urlHash === urlHash)?.engine ?? null;
  if (storedEngine) successfulEngineByUrlHash.set(urlHash, storedEngine);
  return storedEngine;
};

export const forgetRememberedPlaybackEngine = (
  url: string,
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const urlHash = playbackEngineUrlHash(url);
  const deleted = successfulEngineByUrlHash.delete(urlHash);
  const stored = readStoredPlaybackEngines(storage);
  const filtered = stored.filter(entry => entry.urlHash !== urlHash);
  if (filtered.length !== stored.length) writeStoredPlaybackEngines(filtered, storage);
  return deleted || filtered.length !== stored.length;
};

export const clearRememberedPlaybackEngines = (storage?: PlaybackEnginePreferenceStorage | null) => {
  successfulEngineByUrlHash.clear();
  const resolvedStorage = resolvePlaybackEngineStorage(storage);
  if (resolvedStorage) resolvedStorage.removeItem(REMEMBERED_PLAYBACK_ENGINES_STORAGE_KEY);
};

interface StoredAdaptiveLevel {
  urlHash: string;
  level: AdaptiveBufferLevel;
  rememberedAt: number;
}

const REMEMBERED_ADAPTIVE_LEVELS_STORAGE_KEY = 'freaky-adaptive-buffer-level-cache-v1';
const MAX_REMEMBERED_ADAPTIVE_LEVELS = 128;
const rememberedAdaptiveLevelsByUrlHash = new Map<string, AdaptiveBufferLevel>();

const isAdaptiveBufferLevel = (value: unknown): value is AdaptiveBufferLevel => value === 0 || value === 1 || value === 2;

const readStoredAdaptiveLevels = (storage?: PlaybackEnginePreferenceStorage | null): StoredAdaptiveLevel[] => {
  const resolvedStorage = resolvePlaybackEngineStorage(storage);
  if (!resolvedStorage) return [];
  try {
    const raw = resolvedStorage.getItem(REMEMBERED_ADAPTIVE_LEVELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is StoredAdaptiveLevel => (
        entry &&
        typeof entry === 'object' &&
        typeof entry.urlHash === 'string' &&
        /^[a-f0-9]{16}$/.test(entry.urlHash) &&
        isAdaptiveBufferLevel(entry.level) &&
        Number.isFinite(entry.rememberedAt)
      ))
      .slice(-MAX_REMEMBERED_ADAPTIVE_LEVELS);
  } catch {
    return [];
  }
};

const writeStoredAdaptiveLevels = (
  entries: StoredAdaptiveLevel[],
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const resolvedStorage = resolvePlaybackEngineStorage(storage);
  if (!resolvedStorage) return;
  try {
    if (entries.length === 0) {
      resolvedStorage.removeItem(REMEMBERED_ADAPTIVE_LEVELS_STORAGE_KEY);
      return;
    }
    resolvedStorage.setItem(
      REMEMBERED_ADAPTIVE_LEVELS_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_REMEMBERED_ADAPTIVE_LEVELS))
    );
  } catch {
    // Remembering a buffer level is an optimisation; playback must not fail if storage is unavailable.
  }
};

export const rememberAdaptiveBufferLevel = (
  url: string,
  level: AdaptiveBufferLevel,
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const urlHash = playbackEngineUrlHash(url);
  if (level === 0) {
    // Level 0 is the default; store nothing so the cache stays small.
    rememberedAdaptiveLevelsByUrlHash.delete(urlHash);
    const stored = readStoredAdaptiveLevels(storage);
    const filtered = stored.filter(entry => entry.urlHash !== urlHash);
    if (filtered.length !== stored.length) writeStoredAdaptiveLevels(filtered, storage);
    return;
  }
  rememberedAdaptiveLevelsByUrlHash.set(urlHash, level);
  const stored = readStoredAdaptiveLevels(storage)
    .filter(entry => entry.urlHash !== urlHash);
  stored.push({ urlHash, level, rememberedAt: Date.now() });
  writeStoredAdaptiveLevels(stored, storage);
};

export const getRememberedAdaptiveBufferLevel = (
  url: string,
  storage?: PlaybackEnginePreferenceStorage | null
): AdaptiveBufferLevel => {
  const urlHash = playbackEngineUrlHash(url);
  const memoryLevel = rememberedAdaptiveLevelsByUrlHash.get(urlHash);
  if (memoryLevel !== undefined) return memoryLevel;
  const storedLevel = readStoredAdaptiveLevels(storage).find(entry => entry.urlHash === urlHash)?.level;
  if (storedLevel !== undefined) rememberedAdaptiveLevelsByUrlHash.set(urlHash, storedLevel);
  return storedLevel ?? 0;
};

export const forgetRememberedAdaptiveBufferLevel = (
  url: string,
  storage?: PlaybackEnginePreferenceStorage | null
) => {
  const urlHash = playbackEngineUrlHash(url);
  const deleted = rememberedAdaptiveLevelsByUrlHash.delete(urlHash);
  const stored = readStoredAdaptiveLevels(storage);
  const filtered = stored.filter(entry => entry.urlHash !== urlHash);
  if (filtered.length !== stored.length) writeStoredAdaptiveLevels(filtered, storage);
  return deleted || filtered.length !== stored.length;
};

export const clearRememberedAdaptiveBufferLevels = (storage?: PlaybackEnginePreferenceStorage | null) => {
  rememberedAdaptiveLevelsByUrlHash.clear();
  const resolvedStorage = resolvePlaybackEngineStorage(storage);
  if (resolvedStorage) resolvedStorage.removeItem(REMEMBERED_ADAPTIVE_LEVELS_STORAGE_KEY);
};
