const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const runtimeDirectories = ['dpapi-runtime', 'libvlc-proxy-runtime'];

for (const directory of runtimeDirectories) {
  const target = path.resolve(projectRoot, directory);
  if (path.dirname(target) !== projectRoot || path.basename(target) !== directory) {
    throw new Error(`Refusing to remove unexpected path: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
}

console.log('Native runtime output directories cleaned.');
