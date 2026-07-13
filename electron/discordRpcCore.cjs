function getDiscordIpcPaths({ platform, env }) {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_, pipeIndex) => `\\\\.\\pipe\\discord-ipc-${pipeIndex}`);
  }

  const basePaths = [...new Set([
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    '/tmp'
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.replace(/\/+$/, '') || '/'))];

  const paths = [];
  for (let pipeIndex = 0; pipeIndex < 10; pipeIndex++) {
    for (const basePath of basePaths) {
      const separator = basePath === '/' ? '' : '/';
      paths.push(`${basePath}${separator}discord-ipc-${pipeIndex}`);
    }
  }
  return paths;
}

module.exports = { getDiscordIpcPaths };
