/*
 * The built-in node:sqlite API is synchronous.  This worker is the only
 * process allowed to open the application database, so imports and aggregate
 * queries cannot stall Electron's main process.
 */
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let database = null;
let databasePath = workerData.databasePath;
let recoveryNotice = null;

function ensureDatabase() {
  if (database) return database;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  try {
    database = new DatabaseSync(databasePath);
    const check = database.prepare('PRAGMA quick_check').get();
    if (!check || check.quick_check !== 'ok') throw new Error('SQLite quick_check failed.');
  } catch (error) {
    try { database?.close(); } catch {}
    database = null;
    const corruptPath = `${databasePath}.corrupt-${Date.now()}`;
    if (fs.existsSync(databasePath)) fs.renameSync(databasePath, corruptPath);
    const backupPath = `${databasePath}.bak`;
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, databasePath);
      database = new DatabaseSync(databasePath);
    } else {
      database = new DatabaseSync(databasePath);
    }
    recoveryNotice = {
      kind: 'sqlite-recovered',
      message: 'The local data database was recovered after a health check failed.',
      quarantinedPath: path.basename(corruptPath)
    };
  }

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      session_id TEXT PRIMARY KEY NOT NULL,
      started_at_utc TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_started_at_idx ON history(started_at_utc DESC);
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY NOT NULL,
      starts_at_utc TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reminders_starts_at_idx ON reminders(starts_at_utc);
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY NOT NULL,
      updated_at_utc TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_revisions (
      kind TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    );
  `);
  return database;
}

function getValue(key, fallback = null) {
  const row = ensureDatabase().prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

function setValue(key, value) {
  ensureDatabase().prepare(`
    INSERT INTO kv_store(key, value, updated_at_utc) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc
  `).run(key, JSON.stringify(value), new Date().toISOString());
}

function runInTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function migrateJsonIfNeeded(legacyHistoryFile, legacyCacheFile) {
  if (getValue('json-migration-v1-complete', false)) return;
  if (legacyCacheFile && fs.existsSync(legacyCacheFile)) {
    try { setValue('cache', JSON.parse(fs.readFileSync(legacyCacheFile, 'utf8'))); } catch {}
  }
  if (legacyHistoryFile && fs.existsSync(legacyHistoryFile)) {
    try {
      const history = JSON.parse(fs.readFileSync(legacyHistoryFile, 'utf8'));
      if (Array.isArray(history)) saveHistory(history);
    } catch {}
  }
  setValue('json-migration-v1-complete', true);
}

function loadHistory() {
  return ensureDatabase().prepare('SELECT payload FROM history ORDER BY started_at_utc ASC').all()
    .flatMap(row => {
      try { return [JSON.parse(row.payload)]; } catch { return []; }
    });
}

function saveHistory(sessions) {
  const db = ensureDatabase();
  const remove = db.prepare('DELETE FROM history');
  const insert = db.prepare('INSERT INTO history(session_id, started_at_utc, payload) VALUES (?, ?, ?)');
  runInTransaction(db, () => {
    remove.run();
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      const startedAtUtc = typeof session?.startTimeUtc === 'string'
        ? session.startTimeUtc
        : typeof session?.StartTime === 'string' ? session.StartTime : new Date(0).toISOString();
      const sessionId = typeof session?.sessionId === 'string' && session.sessionId
        ? session.sessionId : `${startedAtUtc}:${index}`;
      insert.run(sessionId, startedAtUtc, JSON.stringify(session));
    }
  });
}

function appendHistory(session) {
  const startedAtUtc = typeof session?.startTimeUtc === 'string'
    ? session.startTimeUtc
    : typeof session?.StartTime === 'string' ? session.StartTime : new Date(0).toISOString();
  const sessionId = typeof session?.sessionId === 'string' && session.sessionId
    ? session.sessionId : startedAtUtc;
  ensureDatabase().prepare(`
    INSERT INTO history(session_id, started_at_utc, payload) VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      started_at_utc = excluded.started_at_utc,
      payload = excluded.payload
  `).run(sessionId, startedAtUtc, JSON.stringify(session));
}

function saveReminders(reminders) {
  const db = ensureDatabase();
  const remove = db.prepare('DELETE FROM reminders');
  const insert = db.prepare('INSERT INTO reminders(id, starts_at_utc, payload) VALUES (?, ?, ?)');
  runInTransaction(db, () => {
    remove.run();
    for (const reminder of reminders) insert.run(reminder.id, reminder.programmeStartUtc, JSON.stringify(reminder));
  });
}

function handle(action, payload) {
  switch (action) {
    case 'init':
      ensureDatabase();
      migrateJsonIfNeeded(payload.legacyHistoryFile, payload.legacyCacheFile);
      return { recoveryNotice };
    case 'get-cache': return getValue('cache', null);
    case 'set-cache': setValue('cache', payload); return true;
    case 'clear-cache': ensureDatabase().prepare("DELETE FROM kv_store WHERE key = 'cache'").run(); return true;
    case 'load-history': return loadHistory();
    case 'save-history': saveHistory(payload); return true;
    case 'append-history': appendHistory(payload); return true;
    case 'clear-history': saveHistory([]); return true;
    case 'load-reminders': return ensureDatabase().prepare('SELECT payload FROM reminders ORDER BY starts_at_utc ASC').all().flatMap(row => { try { return [JSON.parse(row.payload)]; } catch { return []; } });
    case 'save-reminders': saveReminders(payload); return true;
    case 'set-recordings': setValue('recordings-index', payload); return true;
    case 'get-recordings': return getValue('recordings-index', []);
    case 'storage-health': {
      const check = ensureDatabase().prepare('PRAGMA quick_check').get();
      const stats = fs.statSync(databasePath);
      return { healthy: check?.quick_check === 'ok', databaseBytes: stats.size, recoveryNotice };
    }
    default: throw new Error(`Unknown data worker action '${action}'.`);
  }
}

parentPort.on('message', ({ id, action, payload }) => {
  try {
    parentPort.postMessage({ id, ok: true, result: handle(action, payload) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : 'Data worker operation failed.' });
  }
});
