const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { afterEach, describe, it } = require('node:test');

const { createDataStore } = require('../electron/dataStore.cjs');

const roots = [];
const stores = [];

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-data-store-'));
  const store = createDataStore({ dataDir: root });
  roots.push(root);
  stores.push(store);
  return { root, store };
}

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('SQLite data store', () => {
  it('saves and loads watch history with the native node:sqlite API', async () => {
    const { store } = createStore();
    await store.init();
    const session = {
      sessionId: 'session-1',
      channelId: 'channel-1',
      channelName: 'Channel 1',
      channelGroup: 'News',
      startTimeUtc: '2026-07-14T19:00:00.000Z',
      endTimeUtc: '2026-07-14T19:05:00.000Z',
      bytesConsumed: 1024
    };

    await store.saveHistory([session]);

    assert.deepEqual(await store.loadHistory(), [session]);
  });

  it('saves and loads reminders with the native node:sqlite API', async () => {
    const { store } = createStore();
    await store.init();
    const reminder = {
      id: 'channel-1\u00002026-07-14T20:00:00.000Z',
      channelId: 'channel-1',
      programmeStartUtc: '2026-07-14T20:00:00.000Z',
      programmeTitle: 'Evening News',
      leadMinutes: 10
    };

    await store.saveReminders([reminder]);

    assert.deepEqual(await store.loadReminders(), [reminder]);
  });

  it('orders history by the current startTimeUtc field', async () => {
    const { root, store } = createStore();
    await store.init();
    const session = (sessionId, startTimeUtc) => ({
      sessionId,
      channelId: sessionId,
      channelName: sessionId,
      channelGroup: 'News',
      startTimeUtc,
      endTimeUtc: startTimeUtc,
      bytesConsumed: 0
    });

    await store.saveHistory([
      session('a-later', '2026-07-14T20:00:00.000Z'),
      session('z-earlier', '2026-07-14T19:00:00.000Z')
    ]);

    const database = new DatabaseSync(path.join(root, 'freaky-iptv.sqlite'), { readOnly: true });
    const storedTimes = database.prepare('SELECT session_id, started_at_utc FROM history ORDER BY session_id').all()
      .map(row => ({ ...row }));
    database.close();

    assert.deepEqual(storedTimes, [
      { session_id: 'a-later', started_at_utc: '2026-07-14T20:00:00.000Z' },
      { session_id: 'z-earlier', started_at_utc: '2026-07-14T19:00:00.000Z' }
    ]);
  });

  it('appends one history session without rewriting existing rows', async () => {
    const { root, store } = createStore();
    await store.init();
    const session = (sessionId, startTimeUtc) => ({
      sessionId,
      channelId: sessionId,
      channelName: sessionId,
      channelGroup: 'News',
      startTimeUtc,
      endTimeUtc: startTimeUtc,
      bytesConsumed: 0
    });
    const first = session('first', '2026-07-14T19:00:00.000Z');
    const second = session('second', '2026-07-14T20:00:00.000Z');
    await store.saveHistory([first]);
    const database = new DatabaseSync(path.join(root, 'freaky-iptv.sqlite'));
    database.exec(`
      CREATE TRIGGER reject_history_rewrite
      BEFORE DELETE ON history
      BEGIN
        SELECT RAISE(ABORT, 'history rows must not be rewritten while appending');
      END;
    `);
    database.close();

    assert.equal(typeof store.appendHistory, 'function');
    await store.appendHistory(second);

    assert.deepEqual(await store.loadHistory(), [first, second]);
  });
});
