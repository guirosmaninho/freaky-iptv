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
  storage = undefined
}: InitialPlaybackEngineInput): PlaybackEngine => {
  const rememberedEngine = getRememberedPlaybackEngine(sourceUrl, storage);
  if (rememberedEngine) return rememberedEngine;
  if (streamKind === 'hls') return 'hls';
  if (streamKind === 'native') return 'native';
  return isHighDemandPlaybackQuality(qualityLabel) ? 'proxy-hardware' : 'mpegts';
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
