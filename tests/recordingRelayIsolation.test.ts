import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('main.cjs', 'utf8');

describe('recording relay isolation', () => {
  it('keeps the playback relay alive while using it as the recording input', () => {
    const startHandler = source.slice(source.indexOf("registerTrustedHandle('start-source-recording'"), source.indexOf("registerTrustedHandle('stop-source-recording'"));
    assert.match(startHandler, /const recordingInputUrl = relay \? relay\.url : request\.sourceUrl/);
    assert.doesNotMatch(startHandler, /stopPlaybackRelay\(/);
    assert.match(startHandler, /playbackRelays\.get\(request\.relayId\)/);
  });
});
