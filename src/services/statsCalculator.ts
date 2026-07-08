import type { WatchSession } from '../types';
import { getChannelBaseNamePreserveCase } from './utils';

export interface ChannelStatEntry {
  name: string;
  group: string;
  totalTimeMs: number;
  sessionCount: number;
  barFraction: number;
}

export interface HeatCell {
  dateString: string;
  date: Date;
  intensity: number;
  tooltip: string;
}

export interface HourBar {
  hour: number;
  label: string;
  fraction: number;
  tooltip: string;
}

export interface DayBar {
  dayName: string;
  fraction: number;
  totalMs: number;
}

export interface ComputedStats {
  totalWatchTime: string;
  monthWatchTime: string;
  totalDataFormatted: string;
  yearDataFormatted: string;
  monthDataFormatted: string;
  totalSessions: string;
  avgSessionLength: string;
  longestSession: string;
  longestSessionChannel: string;
  longestSessionStartedAt: string;
  peakHour: string;
  peakDay: string;
  uniqueChannelsWatched: string;
  unmeasuredSessions: string;
  unmeasuredWatchTime: string;
  topChannelsAllTime: ChannelStatEntry[];
  topChannelsLastMonth: ChannelStatEntry[];
  heatmapCells: HeatCell[];
  hourBars: HourBar[];
  dayBars: DayBar[];
  heatmapStartMonth: string;
  heatmapEndMonth: string;
  shareCard: StatsCardData;
}

export interface StatsCardData {
  periodStart: string;
  periodEnd: string;
  totalWatchTime: string;
  totalSessions: string;
  uniqueChannelsWatched: string;
  longestSession: string;
  longestSessionChannel: string;
  heatmapCells: HeatCell[];
  favoriteChannel: string;
}

export interface ComputeStatsOptions {
  rangeStart?: Date | string | number;
  rangeEnd?: Date | string | number;
  now?: Date;
  qualityMappings?: Record<string, string>;
}

type LegacyWatchSession = Partial<WatchSession> & {
  SessionId?: string;
  ChannelId?: string;
  CanonicalChannelId?: string;
  ChannelName?: string;
  BaseChannelName?: string;
  ChannelGroup?: string;
  SelectedAtUtc?: string;
  PlaybackStartedAtUtc?: string;
  StartTimeUtc?: string;
  EndTimeUtc?: string;
  BytesConsumed?: number;
  BytesSource?: WatchSession['bytesSource'];
  PlayingDurationMs?: number;
  BufferingDurationMs?: number;
  StartupLatencyMs?: number;
  StallCount?: number;
  StallDurationMs?: number;
  FailureReason?: string;
  StreamMode?: string;
  QualityLabel?: string;
};

export type NormalizedWatchSession = WatchSession & {
  statStartMs: number;
  statEndMs: number;
  statDurationMs: number;
  statBytes: number;
  statChannelKey: string;
  statChannelName: string;
};

const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric'
});
const HEATMAP_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});
const SESSION_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

export function normalizeWatchSessions(
  sessions: WatchSession[],
  qualityMappings?: Record<string, string>
): NormalizedWatchSession[] {
  return sessions
    .map((session): WatchSession => {
      const legacy = session as LegacyWatchSession;
      return {
        sessionId: legacy.sessionId || legacy.SessionId || '',
        channelId: legacy.channelId || legacy.ChannelId || '',
        canonicalChannelId: legacy.canonicalChannelId || legacy.CanonicalChannelId || '',
        channelName: legacy.channelName || legacy.ChannelName || '',
        baseChannelName: legacy.baseChannelName || legacy.BaseChannelName || '',
        channelGroup: legacy.channelGroup || legacy.ChannelGroup || '',
        selectedAtUtc: legacy.selectedAtUtc || legacy.SelectedAtUtc || '',
        playbackStartedAtUtc: legacy.playbackStartedAtUtc || legacy.PlaybackStartedAtUtc || '',
        startTimeUtc: legacy.startTimeUtc || legacy.StartTimeUtc || '',
        endTimeUtc: legacy.endTimeUtc || legacy.EndTimeUtc || '',
        bytesConsumed: Number(legacy.bytesConsumed ?? legacy.BytesConsumed ?? 0),
        bytesSource: legacy.bytesSource || legacy.BytesSource,
        playingDurationMs: Number(legacy.playingDurationMs ?? legacy.PlayingDurationMs ?? 0),
        bufferingDurationMs: Number(legacy.bufferingDurationMs ?? legacy.BufferingDurationMs ?? 0),
        startupLatencyMs: Number(legacy.startupLatencyMs ?? legacy.StartupLatencyMs ?? 0),
        stallCount: Number(legacy.stallCount ?? legacy.StallCount ?? 0),
        stallDurationMs: Number(legacy.stallDurationMs ?? legacy.StallDurationMs ?? 0),
        failureReason: legacy.failureReason || legacy.FailureReason || '',
        streamMode: legacy.streamMode || legacy.StreamMode || '',
        qualityLabel: legacy.qualityLabel || legacy.QualityLabel || ''
      };
    })
    .map(session => normalizeSessionForStats(session, qualityMappings))
    .filter((session): session is NormalizedWatchSession => session !== null);
}

export function computeStats(sessions: WatchSession[], options: ComputeStatsOptions = {}): ComputedStats {
  const now = options.now ? new Date(options.now) : new Date();
  const rangeStartMs = parseRangeBoundary(options.rangeStart, Number.NEGATIVE_INFINITY);
  const rangeEndMs = parseRangeBoundary(options.rangeEnd, Number.POSITIVE_INFINITY);
  const heatmapReference = Number.isFinite(rangeEndMs)
    ? new Date(Math.max(rangeStartMs, rangeEndMs - 1))
    : now;
  const allValidSessions = normalizeWatchSessions(sessions, options.qualityMappings);
  const validSessions = allValidSessions
    .map(session => clipSessionToRange(session, rangeStartMs, rangeEndMs))
    .filter((session): session is NormalizedWatchSession => session !== null);

  const sharingStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364)).getTime();
  const sharingEnd = endOfLocalDay(now).getTime();
  const shareSessions = allValidSessions
    .map(session => clipSessionToRange(session, sharingStart, sharingEnd))
    .filter((session): session is NormalizedWatchSession => session !== null);
  const shareCard = buildStatsCardData(shareSessions, sharingStart, sharingEnd, now);

  if (validSessions.length === 0) {
    const emptyHeatmap = buildHeatmap([], heatmapReference);
    const emptyHourBars = buildHourBars([]);
    const emptyDayBars = buildDayBars([]);

    return {
      totalWatchTime: '0h 0m',
      monthWatchTime: '0h 0m',
      totalDataFormatted: '0 MB',
      yearDataFormatted: '0 MB',
      monthDataFormatted: '0 MB',
      totalSessions: '0',
      avgSessionLength: '0m',
      longestSession: '-',
      longestSessionChannel: '',
      longestSessionStartedAt: '',
      peakHour: '-',
      peakDay: '-',
      uniqueChannelsWatched: '0',
      unmeasuredSessions: '0',
      unmeasuredWatchTime: '0m',
      topChannelsAllTime: [],
      topChannelsLastMonth: [],
      heatmapCells: emptyHeatmap.cells,
      hourBars: emptyHourBars,
      dayBars: emptyDayBars,
      heatmapStartMonth: emptyHeatmap.startMonth,
      heatmapEndMonth: emptyHeatmap.endMonth,
      shareCard,
    };
  }

  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfCurrentYear = new Date(now.getFullYear(), 0, 1);
  const startOfCurrentMonthMs = startOfCurrentMonth.getTime();
  const startOfCurrentYearMs = startOfCurrentYear.getTime();

  let totalDurationMs = 0;
  let currentMonthDurationMs = 0;
  let totalBytes = 0;
  let currentYearBytes = 0;
  let currentMonthBytes = 0;
  let longestSession: NormalizedWatchSession | null = null;
  let unmeasuredSessionCount = 0;
  let unmeasuredDurationMs = 0;
  const uniqueChannels = new Set<string>();

  for (const session of validSessions) {
    totalDurationMs += session.statDurationMs;
    totalBytes += session.statBytes;
    uniqueChannels.add(session.statChannelKey);

    if (!isCountableByteSource(session.bytesSource)) {
      unmeasuredSessionCount += 1;
      unmeasuredDurationMs += session.statDurationMs;
    }

    if (!longestSession ||
      session.statDurationMs > longestSession.statDurationMs) {
      longestSession = session;
    }

    const monthOverlapMs = overlapMs(session.statStartMs, session.statEndMs, startOfCurrentMonthMs, Number.POSITIVE_INFINITY);
    const yearOverlapMs = overlapMs(session.statStartMs, session.statEndMs, startOfCurrentYearMs, Number.POSITIVE_INFINITY);

    if (monthOverlapMs > 0) {
      currentMonthDurationMs += monthOverlapMs;
      currentMonthBytes += proportionalBytes(session, monthOverlapMs);
    }

    if (yearOverlapMs > 0) {
      currentYearBytes += proportionalBytes(session, yearOverlapMs);
    }
  }

  const hourBars = buildHourBars(validSessions);
  const dayBars = buildDayBars(validSessions);
  const heatmap = buildHeatmap(validSessions, heatmapReference);

  const topHour = hourBars.length > 0 && Math.max(...hourBars.map(hour => hour.fraction)) > 0
    ? hourBars.reduce((previous, current) => (previous.fraction > current.fraction ? previous : current)).label
    : '-';

  const topDay = dayBars.length > 0 && Math.max(...dayBars.map(day => day.fraction)) > 0
    ? dayBars.reduce((previous, current) => (previous.fraction > current.fraction ? previous : current)).dayName
    : '-';

  const longestSessionMs = longestSession
    ? longestSession.statDurationMs
    : 0;

  return {
    totalWatchTime: formatDuration(totalDurationMs),
    monthWatchTime: formatDuration(currentMonthDurationMs),
    totalDataFormatted: formatBytes(totalBytes),
    yearDataFormatted: formatBytes(currentYearBytes),
    monthDataFormatted: formatBytes(currentMonthBytes),
    totalSessions: validSessions.length.toLocaleString(),
    avgSessionLength: formatDuration(totalDurationMs / validSessions.length),
    longestSession: longestSession ? formatDuration(longestSessionMs) : '-',
    longestSessionChannel: longestSession ? longestSession.statChannelName : '',
    longestSessionStartedAt: longestSession ? formatSessionDateTime(new Date(longestSession.statStartMs).toISOString()) : '',
    peakHour: topHour,
    peakDay: topDay,
    uniqueChannelsWatched: uniqueChannels.size.toLocaleString(),
    unmeasuredSessions: unmeasuredSessionCount.toLocaleString(),
    unmeasuredWatchTime: formatDuration(unmeasuredDurationMs),
    topChannelsAllTime: buildTopChannels(validSessions, 10),
    topChannelsLastMonth: buildTopChannels(validSessions, 10, startOfCurrentMonthMs),
    heatmapCells: heatmap.cells,
    hourBars,
    dayBars,
    heatmapStartMonth: heatmap.startMonth,
    heatmapEndMonth: heatmap.endMonth,
    shareCard,
  };
}

export function normalizeSessionForStats(
  session: WatchSession,
  qualityMappings?: Record<string, string>
): NormalizedWatchSession | null {
  if (!session.channelId || !session.startTimeUtc) return null;
  if (session.startTimeUtc.startsWith('0001-01-01') || session.endTimeUtc.startsWith('0001-01-01')) return null;

  const hasPlaybackStart = Boolean(session.playbackStartedAtUtc);
  const statStartValue = hasPlaybackStart ? session.playbackStartedAtUtc || '' : session.startTimeUtc;
  const statStartMs = new Date(statStartValue).getTime();

  if (Number.isNaN(statStartMs)) return null;

  const explicitDurationMs = Number(session.playingDurationMs);
  const hasExplicitDuration = Number.isFinite(explicitDurationMs) && explicitDurationMs > 0;
  const statEndMs = hasExplicitDuration
    ? statStartMs + explicitDurationMs
    : new Date(session.endTimeUtc).getTime();

  if (Number.isNaN(statEndMs)) return null;

  const statDurationMs = Math.max(0, statEndMs - statStartMs);
  if (!Number.isFinite(statDurationMs) || statDurationMs < 0) return null;

  const rawBytes = Number(session.bytesConsumed);
  const bytesSource = session.bytesSource || (rawBytes > 0 ? 'legacy' : undefined);
  const hasCountableByteSource = isCountableByteSource(bytesSource);
  const statBytes = hasCountableByteSource ? rawBytes : 0;
  const statChannelKey = session.canonicalChannelId || session.channelId;
  const statChannelName = getChannelBaseNamePreserveCase(session.channelName, qualityMappings)
    || session.baseChannelName
    || session.channelName;

  return {
    ...session,
    bytesConsumed: Number.isFinite(statBytes) && statBytes > 0 ? statBytes : 0,
    bytesSource,
    statStartMs,
    statEndMs,
    statDurationMs,
    statBytes: Number.isFinite(statBytes) && statBytes > 0 ? statBytes : 0,
    statChannelKey,
    statChannelName
  };
}

export function isCountableByteSource(source: WatchSession['bytesSource'] | undefined): boolean {
  return source === 'network' || source === 'direct-estimate' || source === 'proxy';
}

function buildTopChannels(
  sessions: NormalizedWatchSession[],
  limit: number,
  rangeStartMs = Number.NEGATIVE_INFINITY,
  rangeEndMs = Number.POSITIVE_INFINITY
): ChannelStatEntry[] {
  const channelMap: Record<string, { name: string; group: string; totalMs: number; count: number }> = {};

  for (const session of sessions) {
    const duration = overlapMs(session.statStartMs, session.statEndMs, rangeStartMs, rangeEndMs);
    if (duration <= 0) continue;

    if (!channelMap[session.statChannelKey]) {
      channelMap[session.statChannelKey] = {
        name: session.statChannelName || session.channelName,
        group: session.channelGroup,
        totalMs: 0,
        count: 0
      };
    }

    channelMap[session.statChannelKey].totalMs += duration;
    channelMap[session.statChannelKey].count += 1;
  }

  const sorted = Object.values(channelMap)
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, limit);

  const maxMs = sorted.length > 0 ? sorted[0].totalMs : 1;

  return sorted.map(channel => ({
    name: channel.name,
    group: channel.group,
    totalTimeMs: channel.totalMs,
    sessionCount: channel.count,
    barFraction: Math.max(0, Math.min(1, channel.totalMs / maxMs))
  }));
}

function buildHourBars(sessions: NormalizedWatchSession[]): HourBar[] {
  const byHour = new Array<number>(24).fill(0);

  for (const session of sessions) {
    splitByLocalBoundary(session.statStartMs, session.statEndMs, nextHourBoundaryMs, (startMs, durationMs) => {
      byHour[new Date(startMs).getHours()] += durationMs;
    });
  }

  const maxVal = Math.max(...byHour);
  const max = maxVal <= 0 ? 1 : maxVal;

  return Array.from({ length: 24 }, (_, hour) => {
    const ms = byHour[hour];
    const label = hour === 0 ? '12AM' : hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`;
    return {
      hour,
      label,
      fraction: ms / max,
      tooltip: `${label}: ${formatDuration(ms)}`
    };
  });
}

function buildDayBars(sessions: NormalizedWatchSession[]): DayBar[] {
  const byDay = new Array<number>(7).fill(0);

  for (const session of sessions) {
    splitByLocalBoundary(session.statStartMs, session.statEndMs, nextDayBoundaryMs, (startMs, durationMs) => {
      byDay[new Date(startMs).getDay()] += durationMs;
    });
  }

  const maxVal = Math.max(...byDay);
  const max = maxVal <= 0 ? 1 : maxVal;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return Array.from({ length: 7 }, (_, day) => ({
    dayName: names[day],
    fraction: byDay[day] / max,
    totalMs: byDay[day]
  }));
}

function buildHeatmap(sessions: NormalizedWatchSession[], now: Date): { cells: HeatCell[]; startMonth: string; endMonth: string } {
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  while (endDate.getDay() !== 6) {
    endDate.setDate(endDate.getDate() + 1);
  }

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 370);

  const startMonth = MONTH_YEAR_FORMATTER.format(startDate);
  const endMonth = MONTH_YEAR_FORMATTER.format(endDate);
  const durationMap: Record<string, number> = {};

  for (const session of sessions) {
    splitByLocalBoundary(session.statStartMs, session.statEndMs, nextDayBoundaryMs, (startMs, durationMs) => {
      const dateKey = toLocalDateKey(new Date(startMs));
      durationMap[dateKey] = (durationMap[dateKey] || 0) + (durationMs / (60 * 1000));
    });
  }

  const maxMins = Object.values(durationMap).length > 0 ? Math.max(...Object.values(durationMap)) : 1;
  const max = maxMins <= 0 ? 1 : maxMins;
  const cells: HeatCell[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateKey = toLocalDateKey(currentDate);
    const mins = durationMap[dateKey] || 0;
    const intensity = mins > 0 ? 0.2 + 0.8 * (mins / max) : 0;
    const dateLabel = HEATMAP_DATE_FORMATTER.format(currentDate);

    cells.push({
      dateString: dateKey,
      date: new Date(currentDate),
      intensity,
      tooltip: mins > 0
        ? `${dateLabel}: ${formatDuration(mins * 60 * 1000)}`
        : `${dateLabel}: No activity`
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return { cells, startMonth, endMonth };
}

export function splitByLocalBoundary(
  startMs: number,
  endMs: number,
  nextBoundary: (value: Date) => number,
  visit: (segmentStartMs: number, durationMs: number) => void
) {
  let cursor = startMs;

  while (cursor < endMs) {
    const boundaryMs = nextBoundary(new Date(cursor));
    const segmentEndMs = Math.min(endMs, boundaryMs > cursor ? boundaryMs : cursor + 1);
    const durationMs = segmentEndMs - cursor;

    if (durationMs > 0) {
      visit(cursor, durationMs);
    }

    cursor = segmentEndMs;
  }
}

export function nextHourBoundaryMs(value: Date): number {
  const next = new Date(value);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}

export function nextDayBoundaryMs(value: Date): number {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function overlapMs(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number): number {
  const start = Math.max(startMs, rangeStartMs);
  const end = Math.min(endMs, rangeEndMs);
  return Math.max(0, end - start);
}

export function proportionalBytes(session: NormalizedWatchSession, overlapDurationMs: number): number {
  if (session.statDurationMs <= 0 || session.statBytes <= 0) return 0;
  return Math.round(session.statBytes * Math.min(1, overlapDurationMs / session.statDurationMs));
}

function parseRangeBoundary(value: ComputeStatsOptions['rangeStart'], fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clipSessionToRange(
  session: NormalizedWatchSession,
  rangeStartMs: number,
  rangeEndMs: number
): NormalizedWatchSession | null {
  const clippedStart = Math.max(session.statStartMs, rangeStartMs);
  const clippedEnd = Math.min(session.statEndMs, rangeEndMs);
  if (clippedEnd <= clippedStart) return null;

  const clippedDuration = clippedEnd - clippedStart;
  return {
    ...session,
    statStartMs: clippedStart,
    statEndMs: clippedEnd,
    statDurationMs: clippedDuration,
    statBytes: proportionalBytes(session, clippedDuration)
  };
}

function startOfLocalDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfLocalDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function buildStatsCardData(
  sessions: NormalizedWatchSession[],
  rangeStartMs: number,
  rangeEndMs: number,
  now: Date
): StatsCardData {
  const totalDurationMs = sessions.reduce((sum, session) => sum + session.statDurationMs, 0);
  const longest = sessions.reduce<NormalizedWatchSession | null>(
    (current, session) => !current || session.statDurationMs > current.statDurationMs ? session : current,
    null
  );
  const uniqueChannels = new Set(sessions.map(session => session.statChannelKey));
  const heatmap = buildHeatmap(sessions, now).cells.filter(cell => {
    const cellMs = startOfLocalDay(cell.date).getTime();
    return cellMs >= startOfLocalDay(new Date(rangeStartMs)).getTime()
      && cellMs <= startOfLocalDay(new Date(rangeEndMs)).getTime();
  });
  const periodFormatter = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const top = buildTopChannels(sessions, 1, rangeStartMs, rangeEndMs);
  const favoriteChannel = top.length > 0 ? top[0].name : '-';

  return {
    periodStart: periodFormatter.format(new Date(rangeStartMs)),
    periodEnd: periodFormatter.format(new Date(rangeEndMs)),
    totalWatchTime: formatDuration(totalDurationMs),
    totalSessions: sessions.length.toLocaleString(),
    uniqueChannelsWatched: uniqueChannels.size.toLocaleString(),
    longestSession: longest ? formatDuration(longest.statDurationMs) : '-',
    longestSessionChannel: longest?.statChannelName || '',
    heatmapCells: heatmap,
    favoriteChannel
  };
}

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  const totalMinutes = totalSeconds / 60;
  const totalHours = totalMinutes / 60;

  if (totalHours >= 1) {
    const hours = Math.floor(totalHours);
    const minutes = Math.floor(totalMinutes % 60);
    return `${hours}h ${minutes}m`;
  }

  if (totalMinutes >= 1) {
    return `${Math.floor(totalMinutes)}m`;
  }

  return `${Math.floor(totalSeconds)}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1.0) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1.0) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function formatSessionDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return SESSION_DATE_TIME_FORMATTER.format(date);
}
