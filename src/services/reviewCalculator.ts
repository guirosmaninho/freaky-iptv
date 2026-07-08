import type {
  AnnualReviewData,
  AvailableReview,
  ReviewKind,
  ReviewNamedTotal,
  ReviewPeriod,
  ReviewRankingEntry,
  ReviewSummary,
  ReviewTimelinePoint,
  WatchSession
} from '../types';
import {
  isCountableByteSource,
  nextDayBoundaryMs,
  nextHourBoundaryMs,
  normalizeWatchSessions,
  overlapMs,
  proportionalBytes,
  splitByLocalBoundary,
  toLocalDateKey,
  type NormalizedWatchSession
} from './statsCalculator';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPENED_REVIEW_LIMIT = 128;
const REVIEW_ID_PATTERN = /^(weekly|monthly|annual):[A-Za-z0-9._-]{1,48}$/;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

interface ReviewSlice {
  session: NormalizedWatchSession;
  startMs: number;
  endMs: number;
  durationMs: number;
}

interface MutableRanking {
  key: string;
  name: string;
  group: string;
  totalTimeMs: number;
  sessionCount: number;
}

export function computeAvailableReviews(
  sessions: WatchSession[],
  now = new Date(),
  qualityMappings?: Record<string, string>
): AvailableReview[] {
  const normalized = normalizeWatchSessions(sessions, qualityMappings);
  const periods = resolveReviewPeriods(now);

  return periods.flatMap(period => {
    const slices = sliceSessions(normalized, period);
    if (slices.length === 0) return [];

    const summary = buildReviewSummary(period, slices);
    if (summary.totalWatchMs <= 0) return [];

    return [{
      kind: period.kind,
      period,
      summary,
      annualData: period.kind === 'annual' ? buildAnnualReviewData(summary, slices) : null
    }];
  });
}

export function getDisplayReview(
  reviews: AvailableReview[],
  dismissedReviewIds: readonly string[]
): AvailableReview | null {
  const dismissed = new Set(dismissedReviewIds);
  return reviews.find(review => !dismissed.has(review.period.key)) || null;
}

export function normalizeOpenedReviewIds(ids: readonly unknown[] | undefined): string[] {
  const newestFirst: string[] = [];
  const seen = new Set<string>();

  for (let index = (ids?.length || 0) - 1; index >= 0; index -= 1) {
    const value = ids?.[index];
    if (typeof value !== 'string' || !REVIEW_ID_PATTERN.test(value) || seen.has(value)) continue;
    seen.add(value);
    newestFirst.push(value);
    if (newestFirst.length === OPENED_REVIEW_LIMIT) break;
  }

  return newestFirst.reverse();
}

export function appendOpenedReviewId(ids: readonly string[], id: string): string[] {
  return normalizeOpenedReviewIds([...ids.filter(value => value !== id), id]);
}

function resolveReviewPeriods(now: Date): ReviewPeriod[] {
  const periods: ReviewPeriod[] = [];
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const annualYear = getAnnualReviewYear(localToday);
  if (annualYear !== null) {
    periods.push(createPeriod(
      'annual',
      `annual:${annualYear}`,
      String(annualYear),
      new Date(annualYear, 0, 1),
      new Date(annualYear, 11, 20),
      annualYear
    ));
  }

  const tomorrow = new Date(localToday);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isLastDay = tomorrow.getDate() === 1;

  const m1Date = isLastDay
    ? new Date(localToday.getFullYear(), localToday.getMonth(), 1)
    : new Date(localToday.getFullYear(), localToday.getMonth() - 1, 1);

  const m2Date = new Date(m1Date.getFullYear(), m1Date.getMonth() - 1, 1);

  const monthDates = [m1Date, m2Date];
  for (const start of monthDates) {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    periods.push(createPeriod(
      'monthly',
      `monthly:${start.getFullYear()}-${pad(start.getMonth() + 1)}`,
      MONTH_LABEL.format(start),
      start,
      end,
      start.getFullYear()
    ));
  }

  const S = new Date(localToday);
  S.setDate(S.getDate() - S.getDay());

  const weekSundays = [
    new Date(S),
    new Date(S.getFullYear(), S.getMonth(), S.getDate() - 7)
  ];

  for (const refSunday of weekSundays) {
    const start = new Date(refSunday.getFullYear(), refSunday.getMonth(), refSunday.getDate() - 6);
    const end = new Date(refSunday.getFullYear(), refSunday.getMonth(), refSunday.getDate() + 1);
    const inclusiveEnd = refSunday;
    periods.push(createPeriod(
      'weekly',
      `weekly:${toLocalDateKey(start)}`,
      `Week of ${SHORT_DATE.format(start)} - ${SHORT_DATE.format(inclusiveEnd)}, ${inclusiveEnd.getFullYear()}`,
      start,
      end,
      start.getFullYear()
    ));
  }

  return periods;
}

function getAnnualReviewYear(today: Date): number | null {
  if (today.getMonth() === 11 && today.getDate() >= 20) return today.getFullYear();
  if (today.getMonth() === 0 && today.getDate() <= 5) return today.getFullYear() - 1;
  return null;
}

function createPeriod(
  kind: ReviewKind,
  key: string,
  label: string,
  start: Date,
  end: Date,
  year: number
): ReviewPeriod {
  return {
    kind,
    key,
    label,
    year,
    startUtc: start.toISOString(),
    endUtc: end.toISOString()
  };
}

function sliceSessions(sessions: NormalizedWatchSession[], period: ReviewPeriod): ReviewSlice[] {
  const periodStartMs = new Date(period.startUtc).getTime();
  const periodEndMs = new Date(period.endUtc).getTime();

  return sessions.flatMap(session => {
    const durationMs = overlapMs(session.statStartMs, session.statEndMs, periodStartMs, periodEndMs);
    if (durationMs <= 0) return [];
    return [{
      session,
      startMs: Math.max(session.statStartMs, periodStartMs),
      endMs: Math.min(session.statEndMs, periodEndMs),
      durationMs
    }];
  });
}

function buildReviewSummary(period: ReviewPeriod, slices: ReviewSlice[]): ReviewSummary {
  const channels = buildChannelRankings(slices);
  const daily = new Map<string, number>();
  let totalWatchMs = 0;
  let longest: ReviewSlice | null = null;
  let measuredBytes = 0;
  let hasMeasuredBytes = false;

  for (const slice of slices) {
    totalWatchMs += slice.durationMs;
    if (!longest || slice.durationMs > longest.durationMs) longest = slice;

    if (isCountableByteSource(slice.session.bytesSource)) {
      hasMeasuredBytes = true;
      measuredBytes += proportionalBytes(slice.session, slice.durationMs);
    }

    splitByLocalBoundary(slice.startMs, slice.endMs, nextDayBoundaryMs, (startMs, durationMs) => {
      const key = toLocalDateKey(new Date(startMs));
      daily.set(key, (daily.get(key) || 0) + durationMs);
    });
  }

  const busiestDay = maxMapEntry(daily);
  const busiestDayDate = busiestDay ? localDateFromKey(busiestDay[0]) : null;

  return {
    period,
    totalWatchMs,
    favoriteChannel: channels[0] || null,
    busiestDayLabel: busiestDayDate ? DAY_LABEL.format(busiestDayDate) : '',
    busiestDayMs: busiestDay?.[1] || 0,
    sessionCount: slices.length,
    uniqueChannelCount: channels.length,
    activeDays: daily.size,
    averagePerActiveDayMs: daily.size > 0 ? totalWatchMs / daily.size : 0,
    longestSessionMs: longest?.durationMs || 0,
    longestSessionChannel: longest?.session.statChannelName || '',
    measuredBytes: hasMeasuredBytes ? measuredBytes : null
  };
}

function buildAnnualReviewData(summary: ReviewSummary, slices: ReviewSlice[]): AnnualReviewData {
  const groupTotals = new Map<string, number>();
  const qualityTotals = new Map<string, number>();
  const streamModeTotals = new Map<string, number>();
  const monthTotals = new Array<number>(12).fill(0);
  const weekdayTotals = new Array<number>(7).fill(0);
  const hourTotals = new Array<number>(24).fill(0);
  const weekTotals = new Map<string, number>();
  const activeDates = new Set<string>();
  const startupLatencies: number[] = [];
  let bufferingDurationMs = 0;
  let hasBuffering = false;
  let stallCount = 0;
  let hasStalls = false;
  let stallDurationMs = 0;
  let failureCount = 0;

  for (const slice of slices) {
    addMapTotal(groupTotals, slice.session.channelGroup || 'Uncategorised', slice.durationMs);
    if (slice.session.qualityLabel) addMapTotal(qualityTotals, slice.session.qualityLabel, slice.durationMs);
    if (slice.session.streamMode) addMapTotal(streamModeTotals, formatStreamMode(slice.session.streamMode), slice.durationMs);

    if ((slice.session.startupLatencyMs || 0) > 0) startupLatencies.push(slice.session.startupLatencyMs || 0);
    if ((slice.session.bufferingDurationMs || 0) > 0) {
      hasBuffering = true;
      bufferingDurationMs += proportionalTelemetry(slice, slice.session.bufferingDurationMs || 0);
    }
    if ((slice.session.stallCount || 0) > 0 || (slice.session.stallDurationMs || 0) > 0) {
      hasStalls = true;
      stallCount += Math.max(0, Math.round((slice.session.stallCount || 0) * slice.durationMs / slice.session.statDurationMs));
      stallDurationMs += proportionalTelemetry(slice, slice.session.stallDurationMs || 0);
    }
    if (slice.session.failureReason) failureCount += 1;

    splitByLocalBoundary(slice.startMs, slice.endMs, nextHourBoundaryMs, (startMs, durationMs) => {
      hourTotals[new Date(startMs).getHours()] += durationMs;
    });

    splitByLocalBoundary(slice.startMs, slice.endMs, nextDayBoundaryMs, (startMs, durationMs) => {
      const value = new Date(startMs);
      monthTotals[value.getMonth()] += durationMs;
      weekdayTotals[value.getDay()] += durationMs;
      const dateKey = toLocalDateKey(value);
      activeDates.add(dateKey);
      const weekKey = toLocalDateKey(startOfLocalWeek(value));
      weekTotals.set(weekKey, (weekTotals.get(weekKey) || 0) + durationMs);
    });
  }

  const busiestWeek = maxMapEntry(weekTotals);
  const busiestWeekStart = busiestWeek ? localDateFromKey(busiestWeek[0]) : null;

  return {
    summary,
    equivalentDays: summary.totalWatchMs / DAY_MS,
    topChannels: buildChannelRankings(slices).slice(0, 5),
    topGroups: mapToNamedTotals(groupTotals, summary.totalWatchMs),
    monthlyTotals: MONTH_NAMES.map((label, index) => ({ label, totalTimeMs: monthTotals[index] })),
    weekdayTotals: WEEKDAY_NAMES.map((label, index) => ({ label, totalTimeMs: weekdayTotals[index] })),
    hourTotals: hourTotals.map((totalTimeMs, hour) => ({ label: formatHour(hour), totalTimeMs })),
    qualityTotals: mapToNamedTotals(qualityTotals, summary.totalWatchMs),
    streamModeTotals: mapToNamedTotals(streamModeTotals, summary.totalWatchMs),
    busiestWeekLabel: busiestWeekStart ? `Week of ${SHORT_DATE.format(busiestWeekStart)}` : '',
    busiestWeekMs: busiestWeek?.[1] || 0,
    longestStreakDays: computeLongestStreak(activeDates),
    telemetry: {
      averageStartupLatencyMs: startupLatencies.length > 0
        ? startupLatencies.reduce((sum, value) => sum + value, 0) / startupLatencies.length
        : null,
      bufferingDurationMs: hasBuffering ? bufferingDurationMs : null,
      stallCount: hasStalls ? stallCount : null,
      stallDurationMs: hasStalls ? stallDurationMs : null,
      failureCount: failureCount > 0 ? failureCount : null
    }
  };
}

function buildChannelRankings(slices: ReviewSlice[]): ReviewRankingEntry[] {
  const channels = new Map<string, MutableRanking>();
  const totalMs = slices.reduce((sum, slice) => sum + slice.durationMs, 0);

  for (const slice of slices) {
    const key = slice.session.statChannelKey;
    const current = channels.get(key) || {
      key,
      name: slice.session.statChannelName || slice.session.channelName,
      group: slice.session.channelGroup || 'Uncategorised',
      totalTimeMs: 0,
      sessionCount: 0
    };
    current.totalTimeMs += slice.durationMs;
    current.sessionCount += 1;
    channels.set(key, current);
  }

  return [...channels.values()]
    .sort((left, right) => right.totalTimeMs - left.totalTimeMs || left.name.localeCompare(right.name))
    .map(entry => ({ ...entry, share: totalMs > 0 ? entry.totalTimeMs / totalMs : 0 }));
}

function mapToNamedTotals(values: Map<string, number>, totalMs: number): ReviewNamedTotal[] {
  return [...values.entries()]
    .map(([name, totalTimeMs]) => ({ name, totalTimeMs, share: totalMs > 0 ? totalTimeMs / totalMs : 0 }))
    .sort((left, right) => right.totalTimeMs - left.totalTimeMs || left.name.localeCompare(right.name));
}

function maxMapEntry(values: Map<string, number>): [string, number] | null {
  let result: [string, number] | null = null;
  for (const entry of values.entries()) {
    if (!result || entry[1] > result[1]) result = entry;
  }
  return result;
}

function addMapTotal(values: Map<string, number>, key: string, durationMs: number) {
  values.set(key, (values.get(key) || 0) + durationMs);
}

function startOfLocalWeek(value: Date): Date {
  const result = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const daysSinceMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - daysSinceMonday);
  return result;
}

function computeLongestStreak(dateKeys: Set<string>): number {
  const dates = [...dateKeys]
    .map(key => {
      const [year, month, day] = key.split('-').map(Number);
      return Date.UTC(year, month - 1, day) / DAY_MS;
    })
    .sort((left, right) => left - right);

  let longest = 0;
  let current = 0;
  let previous: number | null = null;

  for (const date of dates) {
    current = previous !== null && date === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = date;
  }
  return longest;
}

function localDateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function proportionalTelemetry(slice: ReviewSlice, value: number): number {
  if (slice.session.statDurationMs <= 0 || value <= 0) return 0;
  return Math.round(value * Math.min(1, slice.durationMs / slice.session.statDurationMs));
}

function formatStreamMode(value: string): string {
  return value
    .replace(/^proxy-/, '')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function getLargestTimelinePoint(points: ReviewTimelinePoint[]): ReviewTimelinePoint | null {
  return points.reduce<ReviewTimelinePoint | null>(
    (largest, point) => !largest || point.totalTimeMs > largest.totalTimeMs ? point : largest,
    null
  );
}
