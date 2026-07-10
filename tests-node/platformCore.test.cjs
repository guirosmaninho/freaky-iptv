const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getFfmpegProxyModes,
  getFfmpegProbeArgs,
  getNativeRuntimeDirectory,
  getNextFfmpegProxyMode,
  resolvePlatformDirectories
} = require('../electron/platformCore.cjs');

test('uses standard macOS data and recordings directories without Windows environment variables', () => {
  const directories = resolvePlatformDirectories({
    platform: 'darwin',
    env: { HOME: '/Users/freaky' },
    appDataPath: '/Users/freaky/Library/Application Support',
    videosPath: '/Users/freaky/Movies'
  });

  assert.equal(directories.dataDir, '/Users/freaky/Library/Application Support/FreakyIPTV');
  assert.equal(directories.recordingDir, '/Users/freaky/Movies/Freaky IPTV');
  assert.equal(directories.legacyDir, '');
});

test('keeps Windows data paths and native runtime identifiers stable', () => {
  const directories = resolvePlatformDirectories({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Freaky\\AppData\\Local', USERPROFILE: 'C:\\Users\\Freaky' }
  });

  assert.equal(directories.dataDir, 'C:\\Users\\Freaky\\AppData\\Local\\FreakyIPTV');
  assert.equal(directories.legacyDir, 'C:\\Users\\Freaky\\AppData\\Local\\IptvPlayer');
  assert.equal(getNativeRuntimeDirectory('win32', 'x64'), 'win-x64');
  assert.equal(getNativeRuntimeDirectory('darwin', 'x64'), 'darwin-x64');
  assert.equal(getNativeRuntimeDirectory('darwin', 'arm64'), 'darwin-arm64');
});

test('uses VideoToolbox and a safe fallback chain on macOS', () => {
  const modes = getFfmpegProxyModes('darwin', 'aac');

  assert.ok(modes['hardware-videotoolbox']);
  assert.match(modes['hardware-videotoolbox'].args.join(' '), /h264_videotoolbox/);
  assert.equal(modes['hardware-videotoolbox'].inputArgs, undefined);
  assert.deepEqual([
    getNextFfmpegProxyMode('darwin', 'copy'),
    getNextFfmpegProxyMode('darwin', 'hardware-videotoolbox'),
    getNextFfmpegProxyMode('darwin', 'software')
  ], ['hardware-videotoolbox', 'software', '']);
  assert.equal(getNextFfmpegProxyMode('win32', 'copy'), 'hardware-d3d11');
});

test('uses a small probe only for the macOS copy relay', () => {
  assert.deepEqual(getFfmpegProbeArgs('darwin', 'copy'), ['-analyzeduration', '250000', '-probesize', '524288']);
  assert.deepEqual(getFfmpegProbeArgs('darwin', 'hardware-videotoolbox'), ['-analyzeduration', '1000000', '-probesize', '2097152']);
  assert.deepEqual(getFfmpegProbeArgs('win32', 'copy'), ['-analyzeduration', '1000000', '-probesize', '2097152']);
});
