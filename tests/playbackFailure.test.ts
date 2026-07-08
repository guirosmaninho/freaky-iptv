import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyPlaybackFailure, redactPlaybackDiagnostic } from '../src/services/playbackFailure';

describe('playback failure diagnostics', () => {
  it('classifies common failures', () => {
    assert.equal(classifyPlaybackFailure('HTTP 401 Unauthorized'), 'authentication');
    assert.equal(classifyPlaybackFailure('startup timeout'), 'timeout');
    assert.equal(classifyPlaybackFailure('unsupported codec HEVC'), 'codec');
    assert.equal(classifyPlaybackFailure('network disconnected'), 'network');
  });

  it('removes credentials and sensitive query values', () => {
    const redacted = redactPlaybackDiagnostic('https://user:pass@example.test/live?token=secret&name=ok');
    assert.doesNotMatch(redacted, /user|pass|secret/);
    assert.match(redacted, /token=REDACTED/);
  });
});
