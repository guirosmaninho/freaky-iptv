const path = require('node:path');

function resolveWorkerPath(directory = __dirname) {
  return path.join(directory.replace(/([/\\])app\.asar(?=[/\\]|$)/, '$1app.asar.unpacked'), 'dataWorker.cjs');
}
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
    const currentWorker = new Worker(resolveWorkerPath(), {
      workerData: { databasePath: path.join(dataDir, 'freaky-iptv.sqlite') }
    });
    worker = currentWorker;
    currentWorker.on('message', message => {
      if (worker !== currentWorker) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(message.error));
    });
    currentWorker.on('error', error => {
      if (worker !== currentWorker) return;
      worker = null;
      rejectPending(error);
    });
    currentWorker.on('exit', code => {
      if (worker !== currentWorker) return;
      // Reject pending requests on a clean exit too: otherwise callers hang
      // forever if the worker exits with code 0 while requests are in flight.
      rejectPending(new Error(`Data worker exited with code ${code}.`));
      worker = null;
    });
    return worker;
  }

  function request(action, payload) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { ensureWorker().postMessage({ id, action, payload }); }
      catch (error) { pending.delete(id); reject(error); }
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

module.exports = { createDataStore, resolveWorkerPath };
