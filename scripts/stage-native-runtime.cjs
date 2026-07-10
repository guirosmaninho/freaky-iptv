const fs = require('node:fs');
const path = require('node:path');

const runtime = process.argv[2];
const allowedRuntimes = new Set(['win-x64', 'darwin-x64', 'darwin-arm64']);
if (!allowedRuntimes.has(runtime)) {
  throw new Error(`Usage: node scripts/stage-native-runtime.cjs <${[...allowedRuntimes].join('|')}>`);
}

const projectRoot = path.resolve(__dirname, '..');
const source = path.resolve(projectRoot, 'native-runtime', runtime);
const destination = path.resolve(projectRoot, 'native-runtime-package');
if (path.dirname(source) !== path.resolve(projectRoot, 'native-runtime') || path.dirname(destination) !== projectRoot) {
  throw new Error('Refusing to stage an unexpected native runtime path.');
}
if (!fs.existsSync(source)) {
  throw new Error(`Native runtime has not been built: ${source}`);
}

fs.rmSync(destination, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
fs.cpSync(source, destination, { recursive: true, preserveTimestamps: true });
fs.writeFileSync(path.join(destination, 'runtime.json'), `${JSON.stringify({ runtime }, null, 2)}\n`, 'utf8');
console.log(`Staged ${runtime} native runtime for packaging.`);
