const { spawnSync } = require('node:child_process');

const target = process.platform === 'win32'
  ? 'build:win'
  : process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)
    ? `build:mac:${process.arch}`
    : '';

if (!target) throw new Error(`Unsupported development platform: ${process.platform}-${process.arch}`);
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', target], { stdio: 'inherit' });
process.exit(result.status || 0);
