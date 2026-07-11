const { spawnSync } = require('node:child_process');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['playwright', 'test', '--update-snapshots'], {
  stdio: 'inherit',
  env: { ...process.env, FREAKYIPTV_VISUAL_SNAPSHOTS: '1' }
});
process.exit(result.status || 0);
