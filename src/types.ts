export interface Channel {
  id: string;
  tvgId: string;
  name: string;
  logoUrl: string;
  groupTitle: string;
  streamUrl: string;
  duration: number;
  attributes: Record<string, string>;
  variants?: Channel[];
}


export interface ParserIssue {
  sourceType: string;
  lineNumber: number;
  message: string;
}

export interface M3UPlaylist {
  sourceUrlHash: string;
  importedAtUtc: string;
  channels: Channel[];
  issues: ParserIssue[];
}

export interface EPGProgram {
  channelId: string;
  title: string;
  subTitle: string;
  description: string;
  category: string;
  iconUrl: string;
  startUtc: string; // ISO String
  stopUtc: string;  // ISO String
  rawStart: string;
  rawStop: string;
}

export interface EpgGuide {
  programsByChannel: Record<string, EPGProgram[]>;
  displayNames: Record<string, string>;
  normalizedNames: Record<string, string>;
  issues: ParserIssue[];
}

export type UiTheme = 'system' | 'light' | 'dark';
export type RecordingMode = 'source-mkv';
export type AdaptiveBufferLevel = 0 | 1 | 2;
export type PlaybackStatus = 'idle' | 'starting' | 'buffering' | 'recovering' | 'playing' | 'failed';
export type PlaybackFailureCode = 'authentication' | 'unavailable' | 'timeout' | 'codec' | 'decode' | 'proxy' | 'network' | 'unknown';

export interface AppSettings {
  playlistUrl: string;
  epgUrl: string;
  lastPlayedChannelId: string;
  favoriteChannelIds: string[];
  recentlyViewedChannelIds: string[];
  volume: number;
  qualityMappings?: Record<string, string>;
  autoRefreshHours?: number;
  autoplayLastChannel?: boolean;
  historyRetentionDays?: number;
  discordRpcEnabled?: boolean;
  discordShowChannel?: boolean;
  discordClientId?: string;
  appearance?: UiTheme;
  recordingDirectory?: string;
  recordingMode?: RecordingMode;
  openedReviewIds?: string[];
  dismissedReviewIds?: string[];
}

export type ReviewKind = 'weekly' | 'monthly' | 'annual';

export interface ReviewPeriod {
  kind: ReviewKind;
  key: string;
  label: string;
  year: number;
  startUtc: string;
  endUtc: string;
}

export interface ReviewRankingEntry {
  key: string;
  name: string;
  group: string;
  totalTimeMs: number;
  sessionCount: number;
  share: number;
}

export interface ReviewNamedTotal {
  name: string;
  totalTimeMs: number;
  share: number;
}

export interface ReviewTimelinePoint {
  label: string;
  totalTimeMs: number;
}

export interface ReviewSummary {
  period: ReviewPeriod;
  totalWatchMs: number;
  favoriteChannel: ReviewRankingEntry | null;
  busiestDayLabel: string;
  busiestDayMs: number;
  sessionCount: number;
  uniqueChannelCount: number;
  activeDays: number;
  averagePerActiveDayMs: number;
  longestSessionMs: number;
  longestSessionChannel: string;
  measuredBytes: number | null;
}

export interface AnnualReviewTelemetry {
  averageStartupLatencyMs: number | null;
  bufferingDurationMs: number | null;
  stallCount: number | null;
  stallDurationMs: number | null;
  failureCount: number | null;
}

export interface AnnualReviewData {
  summary: ReviewSummary;
  equivalentDays: number;
  topChannels: ReviewRankingEntry[];
  topGroups: ReviewNamedTotal[];
  monthlyTotals: ReviewTimelinePoint[];
  weekdayTotals: ReviewTimelinePoint[];
  hourTotals: ReviewTimelinePoint[];
  qualityTotals: ReviewNamedTotal[];
  streamModeTotals: ReviewNamedTotal[];
  busiestWeekLabel: string;
  busiestWeekMs: number;
  longestStreakDays: number;
  telemetry: AnnualReviewTelemetry;
}

export interface AvailableReview {
  kind: ReviewKind;
  period: ReviewPeriod;
  summary: ReviewSummary;
  annualData: AnnualReviewData | null;
}

export interface PlaybackAttempt {
  engine: 'native' | 'hls' | 'mpegts' | 'proxy-copy' | 'proxy-hardware';
  startedAtUtc: string;
  durationMs?: number;
  result: 'pending' | 'playing' | 'failed';
  failureCode?: PlaybackFailureCode;
}

export interface PlaybackFailure {
  code: PlaybackFailureCode;
  message: string;
  attempts: PlaybackAttempt[];
}

export interface RecordingState {
  status: 'idle' | 'recording' | 'finalizing' | 'completed' | 'failed';
  mode: RecordingMode | null;
  path: string | null;
  startedAtUtc: string | null;
  bytes: number;
  error: string | null;
}

export interface RecordingResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
  state?: RecordingState;
  copiedToClipboard?: boolean;
}

export interface PlaybackRelayResult {
  ok: boolean;
  relayId?: string;
  url?: string;
  errorCode?: PlaybackFailureCode;
  error?: string;
}

export interface BackupResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
  settings?: AppSettings;
  historyCount?: number;
  requiresSync?: boolean;
  warnings?: string[];
}

export interface MigrationStatus {
  status: 'migrated' | 'already-current' | 'no-legacy-data';
  copied: string[];
  markerPath: string;
}

export interface CacheSnapshot {
  schemaVersion: number;
  playlistUrlHash: string;
  epgUrlHash: string;
  parserVersion: string;
  savedAtUtc: string;
  channels: Channel[];
  programs: EPGProgram[];
  epgChannelDisplayNames: Record<string, string>;
  epgNormalizedNameMap: Record<string, string>;
}

export interface WatchSession {
  sessionId?: string;
  channelId: string;
  canonicalChannelId?: string;
  channelName: string;
  baseChannelName?: string;
  channelGroup: string;
  selectedAtUtc?: string;
  playbackStartedAtUtc?: string;
  startTimeUtc: string; // ISO String
  endTimeUtc: string;   // ISO String
  bytesConsumed: number;
  bytesSource?: 'network' | 'direct-estimate' | 'unavailable-proxy' | 'legacy' | 'proxy';
  playingDurationMs?: number;
  bufferingDurationMs?: number;
  startupLatencyMs?: number;
  stallCount?: number;
  stallDurationMs?: number;
  failureReason?: string;
  streamMode?: string;
  qualityLabel?: string;
}

export type PlaybackSessionEvent =
  | {
      type: 'playing';
      atUtc: string;
      startupLatencyMs: number;
      streamMode: string;
    }
  | {
      type: 'buffering-start' | 'stalled' | 'ended';
      atUtc: string;
    }
  | {
      type: 'failure';
      atUtc: string;
      reason: string;
    };

export interface StorageInfo {
  dataDir: string;
  settingsFile: string;
  cacheFile: string;
  historyFile: string;
  settingsBytes: number;
  cacheBytes: number;
  historyBytes: number;
  cacheUpdatedAtUtc: string;
  historyUpdatedAtUtc: string;
  migrationStatus: MigrationStatus;
}

export type UpdateStatus = 'idle' | 'unsupported' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';

export interface UpdateCheckResult {
  status: UpdateStatus;
  target: '' | 'nsis' | 'portable' | 'release-page';
  version: string;
  notes: string;
  progress: number;
  message: string;
}
// Extend global window interface for Electron preload IPC handlers
declare global {
  interface Window {
    electron: {
      platform: string;
      loadSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<boolean>;
      loadCache: () => Promise<CacheSnapshot | null>;
      saveCache: (snapshot: CacheSnapshot) => Promise<boolean>;
      loadHistory: () => Promise<WatchSession[]>;
      saveHistory: (sessions: WatchSession[]) => Promise<boolean>;
      getStorageInfo: () => Promise<StorageInfo>;
      clearCache: () => Promise<boolean>;
      clearHistory: () => Promise<boolean>;
      selectRecordingDirectory: () => Promise<string | null>;
      openRecordingDirectory: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      getAppVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateCheckResult>;
      downloadUpdate: () => Promise<UpdateCheckResult>;
      installUpdate: () => Promise<UpdateCheckResult>;
      openReleasePage: () => Promise<boolean>;
      onUpdateStatus: (callback: (state: UpdateCheckResult) => void) => () => void;
      getDataDirectory: () => Promise<string>;
      openDataDirectory: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      openExternalUrl: (url: string) => Promise<boolean>;
      exportBackup: (password: string) => Promise<BackupResult>;
      importBackup: (password: string) => Promise<BackupResult>;
      capturePlaybackFrame: (request: { bounds?: { x: number; y: number; width: number; height: number }; pngDataUrl?: string; channelName: string }) => Promise<RecordingResult>;
      copyStatisticsCard: (request: { pngBytes: Uint8Array }) => Promise<RecordingResult>;
      saveStatisticsCard: (request: { pngBytes: Uint8Array; suggestedName: string }) => Promise<RecordingResult>;
      copyText: (value: string) => Promise<boolean>;
      startSourceRecording: (request: { sourceUrl: string; channelName: string; relayId?: string | null }) => Promise<RecordingResult>;
      stopSourceRecording: () => Promise<RecordingState>;
      getRecordingState: () => Promise<RecordingState>;
      onRecordingStateChange: (callback: (state: RecordingState) => void) => () => void;
      downloadText: (url: string) => Promise<string>;
      startVlcProxy: (url: string, options?: { mode?: 'copy' | 'hardware'; relayId?: string | null }) => Promise<{ ok: boolean; url?: string; errorCode?: PlaybackFailureCode; error?: string }>;
      stopVlcProxy: () => Promise<boolean>;
      getProxyTraffic: () => Promise<number>;
      startPlaybackRelay: (url: string) => Promise<PlaybackRelayResult>;
      stopPlaybackRelay: (relayId?: string | null) => Promise<boolean>;
      getPlaybackRelayTraffic: (relayId?: string | null) => Promise<number>;
      setPlaybackActive: (active: boolean) => Promise<boolean>;
      setWindowFullscreen: (active: boolean) => Promise<boolean>;
      focusAppWindow: () => Promise<boolean>;
      onWindowFullscreenChange: (callback: (active: boolean) => void) => () => void;
      setDiscordActivity: (channelName: string, startTimeIso: string, logoUrl?: string, programTitle?: string) => Promise<boolean>;
      clearDiscordActivity: () => Promise<boolean>;
      onAppBeforeClose: (callback: () => void) => () => void;
      confirmAppClose: () => void;
    };
  }
}
