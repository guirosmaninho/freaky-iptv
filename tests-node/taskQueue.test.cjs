const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskQueue } = require('../electron/taskQueue.cjs');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('limits simultaneous expensive work and starts queued jobs in order', async () => {
  const queue = createTaskQueue(2);
  const gates = Array.from({ length: 4 }, deferred);
  const started = [];
  let active = 0;
  let peak = 0;
  const results = gates.map((gate, index) => queue(async () => {
    started.push(index);
    peak = Math.max(peak, ++active);
    await gate.promise;
    active--;
    return index;
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  gates[1].resolve();
  await results[1];
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  gates.forEach(gate => gate.resolve());
  assert.deepEqual(await Promise.all(results), [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test('a failed job releases its slot for the next recording', async () => {
  const queue = createTaskQueue(1);
  const failed = queue(() => { throw new Error('Unplayable recording'); });
  const successful = queue(async () => 'preview');
  await assert.rejects(failed, /Unplayable recording/);
  assert.equal(await successful, 'preview');
});

test('rejects invalid concurrency instead of creating a stuck queue', () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => createTaskQueue(limit), /positive integer/);
  }
});
