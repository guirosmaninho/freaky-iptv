/** Bound expensive host work without blocking unrelated IPC requests. */
function createTaskQueue(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer.');
  }
  const pending = [];
  let head = 0;
  let active = 0;
  const drain = () => {
    while (active < concurrency && head < pending.length) {
      const { run, resolve, reject } = pending[head++];
      if (head === pending.length) {
        pending.length = 0;
        head = 0;
      }
      active++;
      Promise.resolve().then(run).then(resolve, reject).finally(() => {
        active--;
        drain();
      });
    }
  };
  return run => new Promise((resolve, reject) => {
    pending.push({ run, resolve, reject });
    drain();
  });
}

module.exports = { createTaskQueue };
