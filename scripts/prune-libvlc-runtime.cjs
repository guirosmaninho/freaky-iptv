const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const x86Runtime = path.resolve(projectRoot, 'native-runtime', 'win-x64', 'libvlc-proxy', 'libvlc', 'win-x86');
const expectedParent = path.resolve(projectRoot, 'native-runtime', 'win-x64', 'libvlc-proxy', 'libvlc');

if (path.dirname(x86Runtime) !== expectedParent || path.basename(x86Runtime) !== 'win-x86') {
  throw new Error(`Refusing to remove unexpected path: ${x86Runtime}`);
}

fs.rmSync(x86Runtime, { recursive: true, force: true });
console.log('Removed unused 32-bit LibVLC runtime from the x64 release.');
