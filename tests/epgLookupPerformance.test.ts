import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelEpgReader, getEpgInfoFromPrograms } from '../src/services/epgSchedule';
import type { Channel, EPGProgram } from '../src/types';

test('a cold current-programme lookup reads a logarithmic part of a large schedule', () => {
  const start = Date.UTC(2026, 0, 1);
  const hour = 3_600_000;
  let reads = 0;
  const programs = Array.from({ length: 10_000 }, (_, index) => ({
    channelId: 'channel', title: `Programme ${index}`,
    get startUtc() { reads++; return new Date(start + index * hour).toISOString(); },
    get stopUtc() { reads++; return new Date(start + (index + 1) * hour).toISOString(); }
  } as EPGProgram));
  const result = getEpgInfoFromPrograms(programs, start + 5_000.5 * hour);
  assert.equal(result.program, programs[5_000]);
  assert.equal(result.progress, 50);
  assert.deepEqual(result.upcoming, programs.slice(5_001, 5_004));
  assert.ok(reads < 100, `Read ${reads} date fields to find a single current programme`);
});

test('an ended newer programme still falls back to an overlapping live programme', () => {
  const programme = (start: string, stop: string) => ({ startUtc: start, stopUtc: stop } as EPGProgram);
  const programs = [
    programme('2026-01-01T10:00:00Z', '2026-01-01T14:00:00Z'),
    programme('2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z')
  ];
  assert.equal(getEpgInfoFromPrograms(programs, Date.parse('2026-01-01T13:00:00Z')).program, programs[0]);
  assert.equal(getEpgInfoFromPrograms(programs, Date.parse('2026-01-01T15:00:00Z')).program, null);
});

test('channel variants share a guide result while a new tick advances the programme', () => {
  const programmes = [
    { startUtc: '2026-01-01T10:00:00Z', stopUtc: '2026-01-01T11:00:00Z' },
    { startUtc: '2026-01-01T11:00:00Z', stopUtc: '2026-01-01T12:00:00Z' }
  ] as EPGProgram[];
  const primary = { id: 'channel' } as Channel;
  const variant = { id: 'hd' } as Channel;
  const lookup = new Map([['channel', programmes], ['hd', programmes]]);
  const first = createChannelEpgReader(lookup, Date.parse('2026-01-01T10:30:00Z'));
  assert.equal(first(primary).program, programmes[0]);
  assert.equal(first(primary), first(variant));
  const next = createChannelEpgReader(lookup, Date.parse('2026-01-01T11:30:00Z'));
  assert.equal(next(variant).program, programmes[1]);
  assert.equal(first(primary).program, programmes[0]);
});
