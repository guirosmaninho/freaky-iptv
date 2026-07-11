const path = require('node:path');

function resolvePlatformDirectories({ platform, env = process.env, appDataPath, videosPath }) {
  if (platform === 'win32') {
    const platformPath = path.win32;
    const localAppData = env.LOCALAPPDATA || platformPath.join(env.USERPROFILE || appDataPath, 'AppData', 'Local');
    return {
      dataDir: env.FREAKYIPTV_DATA_DIR || platformPath.join(localAppData, 'FreakyIPTV'),
      legacyDir: platformPath.join(localAppData, 'IptvPlayer'),
      recordingDir: env.FREAKYIPTV_RECORDINGS_DIR || platformPath.join(env.USERPROFILE || localAppData, 'Videos', 'Freaky IPTV')
    };
  }

  if (platform === 'darwin') {
    const platformPath = path.posix;
    const applicationSupport = appDataPath || platformPath.join(env.HOME || '', 'Library', 'Application Support');
    const movies = videosPath || platformPath.join(env.HOME || '', 'Movies');
    return {
      dataDir: env.FREAKYIPTV_DATA_DIR || platformPath.join(applicationSupport, 'FreakyIPTV'),
      legacyDir: '',
      recordingDir: env.FREAKYIPTV_RECORDINGS_DIR || platformPath.join(movies, 'Freaky IPTV')
    };
  }

  const platformPath = path.posix;
  const dataRoot = appDataPath || env.XDG_DATA_HOME || platformPath.join(env.HOME || '', '.local', 'share');
  return {
    dataDir: env.FREAKYIPTV_DATA_DIR || platformPath.join(dataRoot, 'FreakyIPTV'),
    legacyDir: '',
    recordingDir: env.FREAKYIPTV_RECORDINGS_DIR || platformPath.join(videosPath || env.HOME || dataRoot, 'Freaky IPTV')
  };
}

function getNativeRuntimeDirectory(platform, arch) {
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return `darwin-${arch}`;
  throw new Error(`Unsupported native runtime: ${platform}-${arch}`);
}

function getFfmpegProxyModes(platform, audioEncoder) {
  const copy = {
    label: `copy-video-${audioEncoder}`,
    args: ['-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', audioEncoder, '-b:a', '192k']
  };
  const software = {
    label: `libx264-ultrafast-${audioEncoder}`,
    args: ['-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', audioEncoder, '-b:a', '192k']
  };

  if (platform === 'darwin') {
    return {
      copy,
      'hardware-videotoolbox': {
        label: `h264_videotoolbox-${audioEncoder}`,
        args: ['-map', '0:v:0?', '-map', '0:a:0?', '-pix_fmt', 'nv12', '-c:v', 'h264_videotoolbox', '-b:v', '24000k', '-maxrate', '36000k', '-bufsize', '72000k', '-c:a', audioEncoder, '-b:a', '192k']
      },
      software
    };
  }

  return {
    copy,
    'hardware-d3d11': {
      label: `h264_mf-d3d11-high-${audioEncoder}`,
      inputArgs: ['-hwaccel', 'd3d11va'],
      args: ['-map', '0:v:0?', '-map', '0:a:0?', '-pix_fmt', 'nv12', '-c:v', 'h264_mf', '-hw_encoding', '1', '-scenario', 'live_streaming', '-rate_control', 'pc_vbr', '-quality', '100', '-b:v', '24000k', '-maxrate', '36000k', '-bufsize', '72000k', '-c:a', audioEncoder, '-b:a', '192k']
    },
    hardware: {
      label: `h264_mf-high-${audioEncoder}`,
      args: ['-map', '0:v:0?', '-map', '0:a:0?', '-pix_fmt', 'nv12', '-c:v', 'h264_mf', '-hw_encoding', '1', '-scenario', 'live_streaming', '-rate_control', 'pc_vbr', '-quality', '100', '-b:v', '24000k', '-maxrate', '36000k', '-bufsize', '72000k', '-c:a', audioEncoder, '-b:a', '192k']
    },
    software
  };
}

function getFfmpegProbeArgs(platform, mode) {
  // A copy relay only has to identify the transport stream before it can pass
  // through H.264 video. The smaller macOS probe avoids holding the first
  // frame behind a multi-megabyte analysis window on live channels.
  if (platform === 'darwin' && mode === 'copy') {
    return ['-analyzeduration', '250000', '-probesize', '524288'];
  }
  return ['-analyzeduration', '1000000', '-probesize', '2097152'];
}

function getNextFfmpegProxyMode(platform, mode) {
  if (platform === 'darwin') {
    return mode === 'copy' ? 'hardware-videotoolbox' : mode === 'hardware-videotoolbox' ? 'software' : '';
  }
  return mode === 'copy' ? 'hardware-d3d11' : mode === 'hardware-d3d11' ? 'hardware' : mode === 'hardware' ? 'software' : '';
}

module.exports = {
  getFfmpegProxyModes,
  getFfmpegProbeArgs,
  getNativeRuntimeDirectory,
  getNextFfmpegProxyMode,
  resolvePlatformDirectories
};
