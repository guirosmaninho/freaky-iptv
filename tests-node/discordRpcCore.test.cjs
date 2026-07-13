const assert = require('node:assert/strict');
const test = require('node:test');

const { getDiscordIpcPaths } = require('../electron/discordRpcCore.cjs');

test('tries every documented Discord IPC directory on macOS', () => {
  const paths = getDiscordIpcPaths({
    platform: 'darwin',
    env: {
      XDG_RUNTIME_DIR: '/custom/runtime',
      TMPDIR: '/var/folders/user/T/',
      TMP: '/private/tmp',
      TEMP: '/private/var/tmp'
    }
  });

  assert.deepEqual(paths.slice(0, 5), [
    '/custom/runtime/discord-ipc-0',
    '/var/folders/user/T/discord-ipc-0',
    '/private/tmp/discord-ipc-0',
    '/private/var/tmp/discord-ipc-0',
    '/tmp/discord-ipc-0'
  ]);
  assert.equal(paths.length, 50);
  assert.equal(paths.at(-1), '/tmp/discord-ipc-9');
});

test('deduplicates Unix directories and keeps all Windows pipe indices', () => {
  assert.deepEqual(
    getDiscordIpcPaths({
      platform: 'darwin',
      env: { TMPDIR: '/tmp/', TMP: '/tmp', TEMP: '/tmp//' }
    }).slice(0, 2),
    ['/tmp/discord-ipc-0', '/tmp/discord-ipc-1']
  );

  const windowsPaths = getDiscordIpcPaths({ platform: 'win32', env: {} });
  assert.equal(windowsPaths.length, 10);
  assert.equal(windowsPaths[0], '\\\\.\\pipe\\discord-ipc-0');
  assert.equal(windowsPaths[9], '\\\\.\\pipe\\discord-ipc-9');
});
