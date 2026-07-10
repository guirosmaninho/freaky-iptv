const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  throw new Error('The macOS icon can only be generated on macOS.');
}

const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'public', 'cat_icon.png');
const resourceDirectory = path.join(projectRoot, 'build-resources');
const output = path.join(resourceDirectory, 'cat_icon.icns');

fs.mkdirSync(resourceDirectory, { recursive: true });
fs.rmSync(path.join(resourceDirectory, 'cat_icon.iconset'), { recursive: true, force: true });
const result = spawnSync('sips', ['-s', 'format', 'icns', source, '--out', output], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'Could not create macOS icon.');
console.log(`macOS icon created: ${output}`);
