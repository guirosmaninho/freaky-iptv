import type { EPGProgram } from '../types';

export type ChannelEpgInfo = {
  program: EPGProgram | null;
  progress: number;
  upcoming: EPGProgram[];
  nextChangeAtMs: number | null;
};

type ProgramTimeRange = {
  startMs: number;
  stopMs: number;
};

type ProgramScheduleIndex = {
  length: number;
  prefixMaxStopMs: number[];
};

const EMPTY_UPCOMING: EPGProgram[] = [];

export const EMPTY_CHANNEL_EPG_INFO: ChannelEpgInfo = {
  program: null,
  progress: 0,
  upcoming: EMPTY_UPCOMING,
  nextChangeAtMs: null
};

const programTimeCache = new WeakMap<EPGProgram, ProgramTimeRange>();
const programScheduleCache = new WeakMap<EPGProgram[], ProgramScheduleIndex>();

const getProgramTimes = (program: EPGProgram): ProgramTimeRange => {
  const cached = programTimeCache.get(program);
  if (cached) return cached;

  const times = {
    startMs: Date.parse(program.startUtc),
    stopMs: Date.parse(program.stopUtc)
  };
  programTimeCache.set(program, times);
  return times;
};

const getProgramScheduleIndex = (programs: EPGProgram[]): ProgramScheduleIndex => {
  const cached = programScheduleCache.get(programs);
  if (cached?.length === programs.length) return cached;

  const prefixMaxStopMs = new Array<number>(programs.length);
  let maxStopMs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < programs.length; index += 1) {
    const { stopMs } = getProgramTimes(programs[index]);
    if (Number.isFinite(stopMs)) maxStopMs = Math.max(maxStopMs, stopMs);
    prefixMaxStopMs[index] = maxStopMs;
  }

  const scheduleIndex = { length: programs.length, prefixMaxStopMs };
  programScheduleCache.set(programs, scheduleIndex);
  return scheduleIndex;
};

const findProgramIndexAt = (programs: EPGProgram[], nowMs: number) => {
  let low = 0;
  let high = programs.length;

  // Find the first programme that starts after now. XMLTV feeds commonly
  // contain overlapping entries, so stop times cannot direct this search.
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const { startMs } = getProgramTimes(programs[mid]);

    if (startMs <= nowMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  // Prefer the active entry with the latest start time. If that entry has
  // ended, walk backwards to support gaps and nested overlaps.
  if (low === 0 || getProgramScheduleIndex(programs).prefixMaxStopMs[low - 1] <= nowMs) {
    return -1;
  }

  for (let index = low - 1; index >= 0; index--) {
    if (nowMs < getProgramTimes(programs[index]).stopMs) {
      return index;
    }
  }

  return -1;
};

const findNextProgramIndex = (programs: EPGProgram[], nowMs: number) => {
  let low = 0;
  let high = programs.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const { startMs } = getProgramTimes(programs[mid]);

    if (startMs <= nowMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};

export const getEpgInfoFromPrograms = (
  programs: EPGProgram[] | undefined,
  nowMs: number
): ChannelEpgInfo => {
  if (!programs?.length) {
    return EMPTY_CHANNEL_EPG_INFO;
  }

  const activeIndex = findProgramIndexAt(programs, nowMs);
  const activeProgram = activeIndex >= 0 ? programs[activeIndex] : null;

  let progress = 0;
  if (activeProgram) {
    const { startMs, stopMs } = getProgramTimes(activeProgram);
    progress = Math.max(0, Math.min(100, ((nowMs - startMs) / (stopMs - startMs)) * 100));
  }

  const upcomingStartIndex = activeIndex >= 0
    ? activeIndex + 1
    : findNextProgramIndex(programs, nowMs);
  const nextProgramIndex = findNextProgramIndex(programs, nowMs);
  const nextStartMs = nextProgramIndex < programs.length
    ? getProgramTimes(programs[nextProgramIndex]).startMs
    : Number.POSITIVE_INFINITY;
  const activeStopMs = activeProgram
    ? getProgramTimes(activeProgram).stopMs
    : Number.POSITIVE_INFINITY;
  const nextChangeAtMs = Math.min(nextStartMs, activeStopMs);

  return {
    program: activeProgram,
    progress,
    upcoming: programs.slice(upcomingStartIndex, upcomingStartIndex + 3),
    nextChangeAtMs: Number.isFinite(nextChangeAtMs) ? nextChangeAtMs : null
  };
};
