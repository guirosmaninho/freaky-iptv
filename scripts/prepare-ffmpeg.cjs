const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtime = process.argv[2];
const targets = {
  'win-x64': { platform: 'win32', arch: 'x64', binary: 'ffmpeg.exe' },
  'darwin-x64': { platform: 'darwin', arch: 'x64', binary: 'ffmpeg' },
  'darwin-arm64': { platform: 'darwin', arch: 'arm64', binary: 'ffmpeg' }
};
const target = targets[runtime];
if (!target) throw new Error(`Usage: node scripts/prepare-ffmpeg.cjs <${Object.keys(targets).join('|')}>`);

const projectRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(projectRoot, 'node_modules', 'ffmpeg-static');
const binaryNames = ['ffmpeg', 'ffmpeg.exe'];
const metadataSuffixes = ['', '.README', '.LICENSE'];
const markerPath = path.join(projectRoot, '.ffmpeg-target');
const targetBinaryPath = path.join(packageRoot, target.binary);

if (!fs.existsSync(packageRoot)) throw new Error(`ffmpeg-static is not installed: ${packageRoot}`);

const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
if (marker === runtime && fs.existsSync(targetBinaryPath) && fs.statSync(targetBinaryPath).size > 10 * 1024 * 1024) {
  console.log(`FFmpeg runtime already prepared for ${runtime}.`);
  return;
}

for (const binaryName of binaryNames) {
  for (const suffix of metadataSuffixes) {
    const candidate = path.join(packageRoot, `${binaryName}${suffix}`);
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

const result = spawnSync(process.execPath, [path.join(packageRoot, 'install.js')], {
  cwd: projectRoot,
  env: {
    ...process.env,
    npm_config_platform: target.platform,
    npm_config_arch: target.arch
  },
  stdio: 'inherit'
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.existsSync(targetBinaryPath) || fs.statSync(targetBinaryPath).size <= 10 * 1024 * 1024) {
  throw new Error(`FFmpeg runtime was not prepared for ${runtime}.`);
}

fs.writeFileSync(markerPath, `${runtime}\n`, 'utf8');
console.log(`Prepared FFmpeg runtime for ${runtime}.`);
