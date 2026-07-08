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

const EMPTY_UPCOMING: EPGProgram[] = [];

export const EMPTY_CHANNEL_EPG_INFO: ChannelEpgInfo = {
  program: null,
  progress: 0,
  upcoming: EMPTY_UPCOMING,
  nextChangeAtMs: null
};

const programTimeCache = new WeakMap<EPGProgram, ProgramTimeRange>();

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
