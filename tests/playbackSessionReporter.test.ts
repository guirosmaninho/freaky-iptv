import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlaybackSessionReporter } from '../src/services/playbackSessionReporter';
import type { PlaybackSessionEvent } from '../src/types';

describe('playback session reporter', () => {
  it('reports playback start, buffering and end with stable session identity', () => {
    const events: PlaybackSessionEvent[] = [];
    let nowMs = Date.parse('2026-06-18T10:00:02.000Z');
    const reporter = createPlaybackSessionReporter(
      'session-1',
      (_sessionId, event) => events.push(event),
      Date.parse('2026-06-18T10:00:00.000Z'),
      () => nowMs
    );

    reporter.bufferingStart();
    reporter.playing('hardware');
    nowMs += 1_000;
    reporter.bufferingStart();
    nowMs += 500;
    reporter.playing('hardware');
    nowMs += 1_000;
    reporter.ended();

    assert.deepEqual(events.map(event => event.type), ['playing', 'buffering-start', 'playing', 'ended']);
    assert.deepEqual(events[0], {
      type: 'playing',
      atUtc: '2026-06-18T10:00:02.000Z',
      startupLatencyMs: 2_000,
      streamMode: 'hardware'
    });
  });

  it('reports only the final playback failure once', () => {
    const events: PlaybackSessionEvent[] = [];
    const reporter = createPlaybackSessionReporter(
      'session-2',
      (_sessionId, event) => events.push(event),
      0,
      () => Date.parse('2026-06-18T10:00:00.000Z')
    );

    reporter.failure('Playback timeout');
    reporter.failure('Playback timeout');

    assert.deepEqual(events, [{
      type: 'failure',
      atUtc: '2026-06-18T10:00:00.000Z',
      reason: 'Playback timeout'
    }]);
  });
});
