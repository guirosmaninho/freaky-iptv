import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getEpgInfoFromPrograms } from '../src/services/epgSchedule';
import type { EPGProgram } from '../src/types';

const programme = (title: string, start: string, stop: string): EPGProgram => ({
  channelId: 'test-channel',
  title,
  subTitle: '',
  description: '',
  category: '',
  iconUrl: '',
  startUtc: start,
  stopUtc: stop,
  rawStart: '',
  rawStop: ''
});

describe('EPG schedule selection', () => {
  it('selects the most recently started programme when schedules overlap', () => {
    const programmes = [
      programme('Football', '2026-06-18T19:00:00.000Z', '2026-06-18T21:30:00.000Z'),
      programme('News', '2026-06-18T21:00:00.000Z', '2026-06-18T21:30:00.000Z')
    ];

    const result = getEpgInfoFromPrograms(programmes, Date.parse('2026-06-18T21:05:00.000Z'));

    assert.equal(result.program?.title, 'News');
    assert.equal(
      (result as typeof result & { nextChangeAtMs?: number }).nextChangeAtMs,
      Date.parse('2026-06-18T21:30:00.000Z')
    );
  });

  it('reports the next programme start as the next schedule change', () => {
    const programmes = [
      programme('Football', '2026-06-18T19:00:00.000Z', '2026-06-18T21:30:00.000Z'),
      programme('News', '2026-06-18T21:00:00.000Z', '2026-06-18T21:30:00.000Z')
    ];

    const result = getEpgInfoFromPrograms(programmes, Date.parse('2026-06-18T20:55:00.000Z'));

    assert.equal(
      (result as typeof result & { nextChangeAtMs?: number }).nextChangeAtMs,
      Date.parse('2026-06-18T21:00:00.000Z')
    );
  });

  it('does not rescan an entire stale schedule on repeated lookups', () => {
    const startMs = Date.parse('2020-01-01T00:00:00.000Z');
    const schedule = Array.from({ length: 4096 }, (_, index) => programme(
      `Programme ${index}`,
      new Date(startMs + index * 60_000).toISOString(),
      new Date(startMs + (index + 1) * 60_000).toISOString()
    ));
    let indexedReads = 0;
    const observedSchedule = new Proxy(schedule, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      }
    });
    const staleNow = Date.parse('2030-01-01T00:00:00.000Z');

    getEpgInfoFromPrograms(observedSchedule, staleNow);
    indexedReads = 0;
    const result = getEpgInfoFromPrograms(observedSchedule, staleNow + 1000);

    assert.equal(result.program, null);
    assert.ok(indexedReads < 100, `Expected a logarithmic cached lookup, read ${indexedReads} programme entries.`);
  });
});
