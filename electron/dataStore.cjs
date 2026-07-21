const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createDataStore({ dataDir, legacyHistoryFile, legacyCacheFile }) {
  let worker = null;
  let sequence = 0;
  const pending = new Map();

  function rejectPending(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(path.join(__dirname, 'dataWorker.cjs'), {
      workerData: { databasePath: path.join(dataDir, 'freaky-iptv.sqlite') }
    });
    worker.on('message', message => {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(message.error));
    });
    worker.on('error', error => {
      worker = null;
      rejectPending(error);
    });
    worker.on('exit', code => {
      if (code !== 0) rejectPending(new Error(`Data worker exited with code ${code}.`));
      worker = null;
    });
    return worker;
  }

  function request(action, payload) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ id, action, payload });
    });
  }

  return {
    init: () => request('init', { legacyHistoryFile, legacyCacheFile }),
    getCache: () => request('get-cache'),
    setCache: snapshot => request('set-cache', snapshot),
    clearCache: () => request('clear-cache'),
    loadHistory: () => request('load-history'),
    saveHistory: sessions => request('save-history', sessions),
    appendHistory: session => request('append-history', session),
    clearHistory: () => request('clear-history'),
    loadReminders: () => request('load-reminders'),
    saveReminders: reminders => request('save-reminders', reminders),
    setRecordings: recordings => request('set-recordings', recordings),
    getRecordings: () => request('get-recordings'),
    storageHealth: () => request('storage-health'),
    async close() {
      if (worker) await worker.terminate();
      worker = null;
    }
  };
}

module.exports = { createDataStore };
