// Fixtures own disposable data. Avoid waiting on renderer close guards while
// Electron's macOS debugging connection is shutting down.
async function closeTestApp(application) {
  if (!application) return;
  const process = application.process();
  if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
  await application.close().catch(() => {});
}

module.exports = { closeTestApp };
