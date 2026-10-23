const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const architecture = process.argv[2];
const targets = {
  arm64: { suffix: 'arm64', sha256: 'fc6fac08d87f538517d44aca0c5e7a244b67c8c4cb589bf478363a7315fd5e0d' },
  x64: { suffix: 'intel64', sha256: 'ec01530ce69d849dd057fba8876e68ac39bf279dc28de4e9c04e4aec11fc98db' }
};
const target = targets[architecture];
assert.ok(process.platform === 'darwin' && target, 'Usage on macOS: node scripts/prepare-macos-libvlc.cjs <arm64|x64>');

const projectRoot = path.resolve(__dirname, '..');
const version = '3.0.23';
const cache = path.join(os.tmpdir(), `freaky-libvlc-${version}`);
const filename = `vlc-${version}-${target.suffix}.dmg`;
const image = path.join(cache, filename);
const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-libvlc-mount-'));
const output = path.join(projectRoot, 'native-runtime', `darwin-${architecture}`, 'libvlc-proxy');

function run(command, args, timeout = 180_000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}

function validImage() {
  return fs.existsSync(image) && crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex') === target.sha256;
}

fs.mkdirSync(cache, { recursive: true });
let mounted = false;
try {
  if (!validImage()) {
    const temporaryImage = `${image}.download`;
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '150', '--output', temporaryImage,
      `https://download.videolan.org/pub/videolan/vlc/${version}/macosx/${filename}`], 600_000);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(temporaryImage)).digest('hex');
    assert.equal(checksum, target.sha256, 'Official VLC runtime checksum mismatch');
    fs.renameSync(temporaryImage, image);
  }
  run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, image]);
  mounted = true;
  const source = path.join(mount, 'VLC.app', 'Contents', 'MacOS');
  const destination = path.join(output, 'vlc', 'lib');
  fs.rmSync(path.join(output, 'vlc'), { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(source, 'lib'), destination, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  // LibVLC locates plugins relative to its library: lib/vlc/plugins.
  const plugins = path.join(destination, 'vlc', 'plugins');
  fs.cpSync(path.join(source, 'plugins'), plugins, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
  // The helper is headless. These VLC desktop plugins require GUI frameworks
  // that are not part of the compatibility runtime; its relocated cache is stale.
  for (const filename of ['plugins.dat', 'libmacosx_plugin.dylib', 'libosx_notifications_plugin.dylib']) {
    fs.rmSync(path.join(plugins, filename), { force: true });
  }
  // Remove the Intel-only NuGet runtime if an older publish left it behind.
  fs.rmSync(path.join(output, 'libvlc.dylib'), { force: true });
  fs.writeFileSync(path.join(output, 'vlc', 'runtime.json'), `${JSON.stringify({ version, architecture, source: filename, sha256: target.sha256 }, null, 2)}\n`);
  const expected = architecture === 'arm64' ? /arm64/ : /x86_64/;
  for (const name of ['libvlc.dylib', 'libvlccore.dylib']) {
    const library = path.join(destination, name);
    assert.ok(fs.realpathSync(library).startsWith(`${fs.realpathSync(destination)}${path.sep}`), `Library link escapes the runtime: ${name}`);
    assert.match(run('file', ['-bL', library]), expected, `Wrong architecture for ${name}`);
  }
  console.log(`Prepared official LibVLC ${version} runtime for macOS ${architecture}.`);
} finally {
  if (mounted) run('hdiutil', ['detach', mount]);
  fs.rmSync(mount, { recursive: true, force: true });
}
