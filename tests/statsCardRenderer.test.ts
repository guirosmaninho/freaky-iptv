import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasPngSignature, STATS_CARD_HEIGHT, STATS_CARD_WIDTH } from '../src/services/statsCardRenderer';

describe('stats card renderer contract', () => {
  it('uses the required fixed export dimensions', () => {
    assert.equal(STATS_CARD_WIDTH, 1200);
    assert.equal(STATS_CARD_HEIGHT, 736);
  });

  it('validates the complete PNG signature', () => {
    assert.equal(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
    assert.equal(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  });
});
