const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.test-dist');

const tsc = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.test.json'],
  { cwd: root, stdio: 'inherit' }
);

if (tsc.status !== 0) {
  process.exit(tsc.status || 1);
}

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'package.json'), '{"type":"commonjs"}\n', 'utf8');

const testDir = path.join(dist, 'tests');
const testFiles = fs
  .readdirSync(testDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => path.join(testDir, file));

const nodeTest = spawnSync(
  process.execPath,
  [
    '--test',
    ...testFiles,
    ...fs.existsSync(path.join(root, 'tests-node'))
      ? fs.readdirSync(path.join(root, 'tests-node')).filter(file => file.endsWith('.test.cjs')).map(file => path.join(root, 'tests-node', file))
      : []
  ],
  { cwd: root, stdio: 'inherit' }
);

process.exit(nodeTest.status || 0);
