import assert from 'node:assert/strict';
import test from 'node:test';
import { compactPlaybackStateText } from '../src/services/compactPlaybackState';

test('shows connected in the compact player when live playback reports a zero buffer', () => {
  assert.equal(compactPlaybackStateText({ isPlaying: true, bufferingText: 'Playing' }), 'Connected');
  assert.equal(compactPlaybackStateText({ isPlaying: true, bufferingText: 'Buffering 0%' }), 'Connected');
});

test('keeps meaningful compact playback state messages', () => {
  assert.equal(compactPlaybackStateText({ isPlaying: true, bufferingText: 'Buffering 40%' }), 'Buffering 40%');
  assert.equal(compactPlaybackStateText({ isPlaying: true, bufferingText: 'Increasing live buffer' }), 'Increasing live buffer');
  assert.equal(compactPlaybackStateText({ isPlaying: false, bufferingText: 'Opening stream' }), 'Opening stream');
  assert.equal(compactPlaybackStateText({ isPlaying: false, bufferingText: 'Playback error' }), 'Playback error');
});
