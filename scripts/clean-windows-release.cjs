const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const releaseDirectory = path.resolve(projectRoot, 'release');

if (path.dirname(releaseDirectory) !== projectRoot || path.basename(releaseDirectory) !== 'release') {
  throw new Error(`Refusing to remove unexpected path: ${releaseDirectory}`);
}

fs.rmSync(releaseDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
console.log('Windows release directory cleaned.');
