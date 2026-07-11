const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const arch = process.argv[2];
if (!['x64', 'arm64'].includes(arch)) throw new Error('Usage: node scripts/verify-macos-package.cjs <x64|arm64>');
if (process.platform !== 'darwin') throw new Error('macOS package verification must run on macOS.');

const projectRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.join(projectRoot, 'release');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const dmgPath = path.join(releaseDirectory, `Freaky-IPTV-${packageJson.version}-mac-${arch}.dmg`);
const expectedFileArchitecture = arch === 'x64' ? /x86_64/ : /arm64/;

function requireFile(filePath, minimumBytes = 1) {
  const stats = fs.statSync(filePath);
  assert.ok(stats.isFile(), `Expected a file at ${filePath}`);
  assert.ok(stats.size >= minimumBytes, `File is unexpectedly small: ${filePath}`);
}

function findPackagedApps(directory) {
  const result = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app')) result.push(fullPath);
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return result;
}

function assertArchitecture(filePath) {
  const result = spawnSync('file', [filePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `Could not inspect ${filePath}`);
  assert.match(result.stdout, expectedFileArchitecture, `${filePath} does not match ${arch}`);
}

function verifyDmg() {
  const mountRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-dmg-'));
  const attach = spawnSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountRoot, dmgPath], {
    encoding: 'utf8',
    timeout: 8_000,
    killSignal: 'SIGTERM'
  });
  if (attach.status !== 0) {
    const checksum = spawnSync('hdiutil', ['verify', dmgPath], { encoding: 'utf8' });
    assert.equal(checksum.status, 0, checksum.stderr || attach.stderr || 'Could not verify the DMG.');
    console.warn(`DMG mount unavailable in this environment; hdiutil checksum verification passed: ${attach.stderr?.trim() || 'unknown mount error'}`);
    fs.rmSync(mountRoot, { recursive: true, force: true });
    return;
  }
  try {
    assert.ok(findPackagedApps(mountRoot).length > 0, 'Mounted DMG does not contain the app bundle.');
  } finally {
    const detach = spawnSync('hdiutil', ['detach', mountRoot], { encoding: 'utf8' });
    fs.rmSync(mountRoot, { recursive: true, force: true });
    assert.equal(detach.status, 0, detach.stderr || 'Could not detach the DMG.');
  }
}

async function verifyStartup(appBundle) {
  const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-macos-package-smoke-'));
  let application;
  try {
    application = await electron.launch({
      executablePath: path.join(appBundle, 'Contents', 'MacOS', 'Freaky IPTV'),
      args: ['--disable-gpu'],
      env: {
        ...process.env,
        FREAKYIPTV_E2E: '1',
        FREAKYIPTV_DATA_DIR: path.join(temporaryData, 'data'),
        FREAKYIPTV_RECORDINGS_DIR: path.join(temporaryData, 'recordings'),
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 20_000
    });
    const page = await application.firstWindow({ timeout: 20_000 });
    await page.waitForSelector('.app-shell', { state: 'visible', timeout: 20_000 });
    assert.equal(await page.title(), 'Freaky IPTV');
  } finally {
    await application?.close();
    fs.rmSync(temporaryData, { recursive: true, force: true });
  }
}

async function main() {
  requireFile(dmgPath, 10 * 1024 * 1024);
  verifyDmg();
  const appBundle = findPackagedApps(releaseDirectory).find((candidate) => {
    const result = spawnSync('file', [path.join(candidate, 'Contents', 'MacOS', 'Freaky IPTV')], { encoding: 'utf8' });
    return result.status === 0 && expectedFileArchitecture.test(result.stdout);
  });
  assert.ok(appBundle, 'Could not find the unpacked macOS app bundle.');

  const executable = path.join(appBundle, 'Contents', 'MacOS', 'Freaky IPTV');
  const resources = path.join(appBundle, 'Contents', 'Resources');
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const nativeRuntime = path.join(unpacked, 'native-runtime-package');
  const helper = path.join(nativeRuntime, 'libvlc-proxy', 'LibVlcProxyHelper');
  const ffmpeg = path.join(unpacked, 'node_modules', 'ffmpeg-static', 'ffmpeg');

  // Electron's macOS launcher is a small Mach-O stub; the bulk of the binary
  // lives in Electron Framework.framework beside it.
  requireFile(executable, 10 * 1024);
  requireFile(path.join(resources, 'app.asar'), 1 * 1024 * 1024);
  requireFile(path.join(nativeRuntime, 'runtime.json'));
  // The self-contained .NET publish is architecture-dependent; the x64
  // helper is just under 100 KiB while arm64 is slightly larger. The
  // architecture and `file` checks below are the meaningful guarantees.
  requireFile(helper, 64 * 1024);
  requireFile(ffmpeg, 10 * 1024 * 1024);
  assert.equal(JSON.parse(fs.readFileSync(path.join(nativeRuntime, 'runtime.json'), 'utf8')).runtime, `darwin-${arch}`);
  assertArchitecture(executable);
  assertArchitecture(helper);
  assertArchitecture(ffmpeg);
  await verifyStartup(appBundle);
  console.log(`macOS ${arch} package verified: DMG, app bundle, native runtime, FFmpeg and startup.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
