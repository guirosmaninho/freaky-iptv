import type { PlaybackSessionEvent } from '../types';

type PlaybackEventSink = (sessionId: string, event: PlaybackSessionEvent) => void;
type WithoutTimestamp<T> = T extends { atUtc: string } ? Omit<T, 'atUtc'> : never;
type PlaybackSessionEventWithoutTimestamp = WithoutTimestamp<PlaybackSessionEvent>;

export interface PlaybackSessionReporter {
  playing: (streamMode: string) => void;
  bufferingStart: () => void;
  stalled: () => void;
  ended: () => void;
  failure: (reason: string) => void;
}

export function createPlaybackSessionReporter(
  sessionId: string,
  emit: PlaybackEventSink,
  attemptStartedAtMs = Date.now(),
  now: () => number = Date.now
): PlaybackSessionReporter {
  let hasStarted = false;
  let failureReported = false;

  const emitAt = (event: PlaybackSessionEventWithoutTimestamp) => {
    emit(sessionId, {
      ...event,
      atUtc: new Date(now()).toISOString()
    } as PlaybackSessionEvent);
  };

  return {
    playing(streamMode) {
      const atMs = now();
      emit(sessionId, {
        type: 'playing',
        atUtc: new Date(atMs).toISOString(),
        startupLatencyMs: hasStarted ? 0 : Math.max(0, atMs - attemptStartedAtMs),
        streamMode
      });
      hasStarted = true;
    },

    bufferingStart() {
      if (hasStarted) emitAt({ type: 'buffering-start' });
    },

    stalled() {
      if (hasStarted) emitAt({ type: 'stalled' });
    },

    ended() {
      if (hasStarted) emitAt({ type: 'ended' });
    },

    failure(reason) {
      if (failureReported) return;
      failureReported = true;
      emitAt({ type: 'failure', reason });
    }
  };
}
