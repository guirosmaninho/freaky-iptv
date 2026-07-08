const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_MARKER = 'migration-v1.json';
const KNOWN_FILES = ['settings.json', 'watch_history.json', path.join('cache', 'snapshot.json')];

function copyFileAtomic(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  fs.renameSync(temporary, target);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}

function createFileSnapshot(files, snapshotDir) {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const entries = files.map((filePath, index) => {
    const exists = fs.existsSync(filePath);
    const snapshotName = `${index}-${path.basename(filePath)}`;
    if (exists) fs.copyFileSync(filePath, path.join(snapshotDir, snapshotName));
    return { filePath, exists, snapshotName };
  });
  writeJsonAtomic(path.join(snapshotDir, 'manifest.json'), { entries });
  return snapshotDir;
}

function restoreFileSnapshot(snapshotDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  if (!manifest || !Array.isArray(manifest.entries)) throw new Error('Invalid safety snapshot.');
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.filePath !== 'string' || typeof entry.snapshotName !== 'string') throw new Error('Invalid safety snapshot.');
    if (!entry.exists) {
      fs.rmSync(entry.filePath, { force: true });
      continue;
    }
    const source = path.join(snapshotDir, path.basename(entry.snapshotName));
    fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
    const temporary = `${entry.filePath}.${process.pid}.restore.tmp`;
    fs.copyFileSync(source, temporary);
    fs.renameSync(temporary, entry.filePath);
  }
}

function migrateLegacyData({ legacyDir, dataDir, now = () => new Date() }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const markerPath = path.join(dataDir, MIGRATION_MARKER);
  if (fs.existsSync(markerPath)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (!marker || typeof marker !== 'object' || !Array.isArray(marker.copied)) throw new Error('Invalid migration marker.');
      return { status: marker.status || 'already-current', copied: marker.copied, markerPath };
    } catch {
      const stamp = now().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(markerPath, `${markerPath}.corrupt-${stamp}`);
    }
  }

  const copied = [];
  if (fs.existsSync(legacyDir)) {
    for (const relativePath of KNOWN_FILES) {
      const source = path.join(legacyDir, relativePath);
      const target = path.join(dataDir, relativePath);
      if (!fs.existsSync(source) || fs.existsSync(target)) continue;
      copyFileAtomic(source, target);
      copied.push(relativePath.replaceAll('\\', '/'));
    }
  }

  const status = copied.length > 0
    ? 'migrated'
    : (fs.existsSync(legacyDir) ? 'already-current' : 'no-legacy-data');
  writeJsonAtomic(markerPath, {
    schemaVersion: 1,
    status,
    source: legacyDir,
    migratedAtUtc: now().toISOString(),
    copied
  });
  return { status, copied, markerPath };
}

module.exports = { KNOWN_FILES, MIGRATION_MARKER, createFileSnapshot, migrateLegacyData, restoreFileSnapshot, writeJsonAtomic };
