const { spawnSync } = require('node:child_process');

const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
if (branch.status !== 0 || !branch.stdout.trim()) throw new Error('Could not determine the current Git branch.');
const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.status !== 0) throw new Error('Could not inspect the Git worktree.');
if (status.stdout.trim()) throw new Error('Commit or stash local changes before triggering a release.');

const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: 'inherit' });
if (auth.status !== 0) throw new Error('Authenticate the GitHub CLI with `gh auth login` before running release:all.');

const trigger = spawnSync('gh', ['workflow', 'run', 'release.yml', '--ref', branch.stdout.trim()], { encoding: 'utf8', stdio: 'inherit' });
if (trigger.status !== 0) process.exit(trigger.status || 1);
console.log('Release workflow triggered. Follow it with: gh run list --workflow release.yml --limit 1');
