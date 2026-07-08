import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRelativeChannelIndex, isEditableShortcutTarget, nextVolume } from '../src/services/channelNavigation';

describe('channel navigation', () => {
  it('wraps previous and next channel indexes', () => {
    assert.equal(getRelativeChannelIndex(0, -1, 3), 2);
    assert.equal(getRelativeChannelIndex(2, 1, 3), 0);
    assert.equal(getRelativeChannelIndex(-1, 1, 3), 0);
  });

  it('changes volume in five point steps and clamps the result', () => {
    assert.equal(nextVolume(98, 1), 100);
    assert.equal(nextVolume(2, -1), 0);
    assert.equal(nextVolume(40, 1), 45);
  });

  it('does not intercept editable or slider targets', () => {
    assert.equal(isEditableShortcutTarget({ tagName: 'INPUT' }), true);
    assert.equal(isEditableShortcutTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isEditableShortcutTarget({ tagName: 'DIV', role: 'slider' }), true);
    assert.equal(isEditableShortcutTarget({ tagName: 'BUTTON' }), false);
  });
});
