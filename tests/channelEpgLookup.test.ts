import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChannelProgramLookup } from '../src/services/channelEpgLookup';
import type { Channel, EpgGuide, EPGProgram } from '../src/types';

const channel = (id: string, name: string, tvgId: string): Channel => ({
  id, name, tvgId, logoUrl: '', groupTitle: 'Portugal', streamUrl: '', duration: 0, attributes: {}
});
const schedule = [{ title: 'Goucha' } as EPGProgram];
const guide: EpgGuide = {
  programsByChannel: { 'TVIInt.pt': schedule, 'RTP.pt': schedule },
  displayNames: { 'TVIInt.pt': 'PT: TVE Internacional', 'RTP.pt': 'PT: RTP 1' },
  normalizedNames: { pttveinternacional: 'TVIInt.pt', ptrtp1hd: 'RTP.pt' },
  issues: []
};

test('withholds an XMLTV ID shared by distinct channels, including name fallback', () => {
  const result = buildChannelProgramLookup([
    channel('tvi', 'PT: TVI Internacional', 'TVIInt.pt'),
    channel('tve', 'PT: TVE Internacional', 'TVIInt.pt')
  ], guide);
  assert.deepEqual(result.programs.get('tvi'), []);
  assert.deepEqual(result.programs.get('tve'), []);
  assert.ok(result.ambiguousIds.has('tvi'));
  assert.ok(result.ambiguousIds.has('tve'));
});

test('allows equivalent quality variants to share the same schedule', () => {
  const hd = channel('hd', 'PT: RTP 1 HD', 'RTP.pt');
  const full = channel('fhd', 'PT: RTP 1 Full HD', 'RTP.pt');
  const result = buildChannelProgramLookup([{ ...hd, variants: [hd, full] }], guide);
  assert.equal(result.programs.get('hd'), schedule);
  assert.equal(result.programs.get('fhd'), schedule);
  assert.equal(result.ambiguousIds.size, 0);
});

test('does not bypass a conflicting ID through a display-name lookup', () => {
  const result = buildChannelProgramLookup([
    channel('tvi', 'PT: TVI Internacional', 'TVIInt.pt'),
    channel('tve', 'PT: TVE Internacional', 'TVIInt.pt'),
    channel('fallback', 'PT: TVE Internacional', '')
  ], guide);
  assert.deepEqual(result.programs.get('fallback'), []);
  assert.ok(result.ambiguousIds.has('fallback'));
});

test('uses a safe alternative ID when another variant points at a conflicting ID', () => {
  const tvi = channel('tvi', 'PT: TVI Internacional', 'TVIInt.pt');
  const alternate = channel('alternate', 'PT: TVI Internacional HD', 'RTP.pt');
  const result = buildChannelProgramLookup([
    { ...tvi, variants: [tvi, alternate] },
    channel('tve', 'PT: TVE Internacional', 'TVIInt.pt')
  ], guide);
  assert.equal(result.programs.get('tvi'), schedule);
  assert.equal(result.ambiguousIds.has('tvi'), false);
  assert.equal(result.ambiguousIds.has('tve'), true);
});

test('treats Canal and Canal+ as distinct channels even if their source IDs match', () => {
  const result = buildChannelProgramLookup([
    channel('plain', 'PT: Canal HD', 'RTP.pt'),
    channel('plus', 'PT: Canal+ Full HD', 'RTP.pt')
  ], guide);
  assert.deepEqual(result.programs.get('plain'), []);
  assert.deepEqual(result.programs.get('plus'), []);
  assert.equal(result.ambiguousIds.has('plain'), true);
  assert.equal(result.ambiguousIds.has('plus'), true);
});

test('still shares a schedule between quality variants of a plus channel', () => {
  const hd = channel('plus-hd', 'PT: Canal+ HD', 'RTP.pt');
  const full = channel('plus-full', 'PT: Canal+ Full HD', 'RTP.pt');
  const result = buildChannelProgramLookup([{ ...hd, variants: [hd, full] }], guide);
  assert.equal(result.programs.get('plus-hd'), schedule);
  assert.equal(result.programs.get('plus-full'), schedule);
  assert.equal(result.ambiguousIds.size, 0);
});
