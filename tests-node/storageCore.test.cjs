const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');

const { MIGRATION_MARKER, createFileSnapshot, migrateLegacyData, restoreFileSnapshot } = require('../electron/storageCore.cjs');

const roots = [];

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-storage-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('safety snapshots', () => {
  it('restores existing files and removes files created after the snapshot', () => {
    const root = tempRoot();
    const existing = path.join(root, 'settings.json');
    const initiallyMissing = path.join(root, 'history.json');
    const snapshot = path.join(root, 'snapshot');
    fs.writeFileSync(existing, 'before');
    createFileSnapshot([existing, initiallyMissing], snapshot);

    fs.writeFileSync(existing, 'after');
    fs.writeFileSync(initiallyMissing, 'created');
    restoreFileSnapshot(snapshot);

    assert.equal(fs.readFileSync(existing, 'utf8'), 'before');
    assert.equal(fs.existsSync(initiallyMissing), false);
  });
});

describe('migrateLegacyData', () => {
  it('copies known legacy files without deleting the old data', () => {
    const root = tempRoot();
    const legacyDir = path.join(root, 'IptvPlayer');
    const dataDir = path.join(root, 'FreakyIPTV');
    fs.mkdirSync(path.join(legacyDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), '{"legacy":true}');
    fs.writeFileSync(path.join(legacyDir, 'watch_history.json'), '[]');
    fs.writeFileSync(path.join(legacyDir, 'cache', 'snapshot.json'), '{"cache":true}');

    const result = migrateLegacyData({ legacyDir, dataDir, now: () => new Date('2026-06-20T10:00:00Z') });

    assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), '{"legacy":true}');
    assert.equal(fs.readFileSync(path.join(dataDir, 'cache', 'snapshot.json'), 'utf8'), '{"cache":true}');
    assert.equal(fs.existsSync(path.join(legacyDir, 'settings.json')), true);
    assert.equal(result.status, 'migrated');
    assert.deepEqual(result.copied.sort(), ['cache/snapshot.json', 'settings.json', 'watch_history.json']);
  });

  it('keeps files that already exist in the new directory and is idempotent', () => {
    const root = tempRoot();
    const legacyDir = path.join(root, 'IptvPlayer');
    const dataDir = path.join(root, 'FreakyIPTV');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), '{"old":true}');
    fs.writeFileSync(path.join(dataDir, 'settings.json'), '{"new":true}');

    const first = migrateLegacyData({ legacyDir, dataDir });
    const second = migrateLegacyData({ legacyDir, dataDir });

    assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), '{"new":true}');
    assert.equal(first.status, 'already-current');
    assert.equal(second.status, 'already-current');
  });

  it('recovers from a corrupt migration marker', () => {
    const root = tempRoot();
    const legacyDir = path.join(root, 'IptvPlayer');
    const dataDir = path.join(root, 'FreakyIPTV');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), '{"legacy":true}');
    fs.writeFileSync(path.join(dataDir, MIGRATION_MARKER), '{broken');

    const result = migrateLegacyData({ legacyDir, dataDir });

    assert.equal(result.status, 'migrated');
    assert.equal(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), '{"legacy":true}');
    assert.ok(fs.readdirSync(dataDir).some(name => name.startsWith(`${MIGRATION_MARKER}.corrupt-`)));
  });
});
