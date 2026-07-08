const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  decryptBackup,
  encryptBackup,
  mergeImportedData,
  validateBackupPayload,
  validateBackupPassword
} = require('../electron/backupCore.cjs');

describe('encrypted backups', () => {
  it('round trips a payload without storing plaintext credentials', async () => {
    const payload = {
      schemaVersion: 1,
      createdAtUtc: '2026-06-20T10:00:00.000Z',
      settings: { playlistUrl: 'https://provider.test/list?token=secret' },
      history: []
    };

    const envelope = await encryptBackup(payload, 'correct horse battery staple');
    const serialized = JSON.stringify(envelope);

    assert.doesNotMatch(serialized, /provider\.test|secret/);
    assert.deepEqual(await decryptBackup(envelope, 'correct horse battery staple'), payload);
    await assert.rejects(() => decryptBackup(envelope, 'wrong password'), /could not be opened/i);
  });

  it('requires passwords with at least ten characters', () => {
    assert.equal(validateBackupPassword('short'), false);
    assert.equal(validateBackupPassword('0123456789'), true);
  });

  it('rejects authenticated content changes with a generic error', async () => {
    const envelope = await encryptBackup({ schemaVersion: 1, settings: {}, history: [] }, 'correct-password');
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    await assert.rejects(() => decryptBackup(envelope, 'correct-password'), /could not be opened/i);
  });

  it('rejects unsupported schemas and malformed collections', () => {
    assert.throws(() => validateBackupPayload({ schemaVersion: 2, settings: {}, history: [] }), /could not be opened/i);
    assert.throws(() => validateBackupPayload({ schemaVersion: 1, settings: {}, history: 'invalid' }), /could not be opened/i);
  });
});

describe('mergeImportedData', () => {
  it('replaces normal settings while merging favorites, recents and history', () => {
    const current = {
      settings: {
        playlistUrl: 'old',
        favoriteChannelIds: ['a'],
        recentlyViewedChannelIds: ['old', 'shared'],
        openedReviewIds: ['weekly:2026-W20'],
        dismissedReviewIds: ['weekly:2026-W19'],
        volume: 20
      },
      history: [{ sessionId: 'existing', channelId: 'a' }]
    };
    const imported = {
      settings: {
        playlistUrl: 'new',
        favoriteChannelIds: ['b', 'a'],
        recentlyViewedChannelIds: ['new', 'shared'],
        openedReviewIds: ['monthly:2026-05'],
        dismissedReviewIds: ['monthly:2026-04'],
        volume: 80
      },
      history: [
        { sessionId: 'existing', channelId: 'a' },
        { sessionId: 'imported', channelId: 'b' }
      ]
    };

    const result = mergeImportedData(current, imported);

    assert.equal(result.settings.playlistUrl, 'new');
    assert.equal(result.settings.volume, 80);
    assert.deepEqual(result.settings.favoriteChannelIds, ['b', 'a']);
    assert.deepEqual(result.settings.recentlyViewedChannelIds, ['new', 'shared', 'old']);
    assert.deepEqual(result.settings.openedReviewIds, ['monthly:2026-05', 'weekly:2026-W20']);
    assert.deepEqual(result.settings.dismissedReviewIds, ['monthly:2026-04', 'weekly:2026-W19']);
    assert.deepEqual(result.history.map(item => item.sessionId), ['existing', 'imported']);
  });
});
