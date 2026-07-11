const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createPortableReplacementPlan,
  isSafePortableExecutablePath
} = require('../electron/portableUpdate.cjs');

test('creates a detached replacement plan that only touches files beside the portable executable', () => {
  const executablePath = path.win32.join('C:', 'Apps', 'Freaky IPTV-1.0.1-Portable-x64.exe');
  const downloadedPath = path.win32.join('C:', 'Apps', '.Freaky IPTV-1.0.2-Portable-x64.exe.download');
  const plan = createPortableReplacementPlan({ executablePath, downloadedPath, pid: 4242 });

  assert.equal(plan.backupPath, path.win32.join('C:', 'Apps', '.Freaky IPTV-1.0.1-Portable-x64.exe.previous'));
  assert.equal(path.win32.dirname(plan.scriptPath), path.win32.dirname(executablePath));
  assert.match(plan.script, /tasklist \/FI "PID eq 4242"/);
  assert.match(plan.script, /move \/Y/);
  assert.match(plan.script, /start ""/);
  assert.match(plan.script, /\.previous/);
});

test('refuses portable updater paths outside the executable directory and shell metacharacters', () => {
  const executablePath = path.win32.join('C:', 'Apps', 'Freaky IPTV-1.0.1-Portable-x64.exe');

  assert.equal(isSafePortableExecutablePath(executablePath), true);
  assert.equal(isSafePortableExecutablePath(path.win32.join('C:', 'Apps', 'Freaky-IPTV-1.0.1-Portable-x64.exe')), true);
  assert.equal(isSafePortableExecutablePath(path.win32.join('C:', 'Apps', 'Freaky%IPTV.exe')), false);
  assert.equal(isSafePortableExecutablePath(path.win32.join('C:', 'Apps', 'other.exe')), false);
  assert.throws(
    () => createPortableReplacementPlan({ executablePath, downloadedPath: path.win32.join('C:', 'Other', 'update.exe'), pid: 4242 }),
    /same directory/i
  );
});
