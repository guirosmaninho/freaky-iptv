import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getChannelInitials, isUsableChannelLogo } from '../src/services/channelArtwork';

test('fallback removes country and quality markers and retains channel acronyms', () => {
  assert.equal(getChannelInitials('PT: RTP 1 Full HD'), 'RTP1');
  assert.equal(getChannelInitials('PT: SIC HD'), 'SIC');
  assert.equal(getChannelInitials('PT: Sport TV 1 Full HD'), 'ST');
  assert.equal(getChannelInitials(''), 'TV');
});

test('falls back for the LyngSat website placeholder, but allows unrelated logos', () => {
  assert.equal(isUsableChannelLogo('https://www.lyngsat.com/logo/example.png'), false);
  assert.equal(isUsableChannelLogo('https://cdn.example.com/logo.png'), true);
  assert.equal(isUsableChannelLogo('https://lyngsat-logo.com/logo.png'), true);
  assert.equal(isUsableChannelLogo(''), false);
});
