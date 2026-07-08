import type { PlaybackFailureCode } from '../types';

export const classifyPlaybackFailure = (message: string): PlaybackFailureCode => {
  const value = message.toLowerCase();
  if (/\b(401|403|unauthori[sz]ed|forbidden|authentication)\b/.test(value)) return 'authentication';
  if (/\b(404|410|unavailable|not found)\b/.test(value)) return 'unavailable';
  if (/timeout|timed out/.test(value)) return 'timeout';
  if (/codec|hevc|h\.265|ac3|eac3|unsupported/.test(value)) return 'codec';
  if (/decode|decoder|media_err_decode/.test(value)) return 'decode';
  if (/proxy|ffmpeg|libvlc/.test(value)) return 'proxy';
  if (/network|disconnected|connection|dns|socket/.test(value)) return 'network';
  return 'unknown';
};

export const redactPlaybackDiagnostic = (input: string) => {
  return input.replace(/https?:\/\/[^\s]+/gi, raw => {
    try {
      const url = new URL(raw);
      url.username = '';
      url.password = '';
      for (const key of url.searchParams.keys()) {
        if (/token|key|auth|pass|user|credential|signature/i.test(key)) url.searchParams.set(key, 'REDACTED');
      }
      return url.toString();
    } catch {
      return '[REDACTED URL]';
    }
  });
};

export const playbackFailureMessage = (code: PlaybackFailureCode) => {
  const messages: Record<PlaybackFailureCode, string> = {
    authentication: 'The provider rejected this stream. Check the playlist credentials.',
    unavailable: 'This stream is currently unavailable.',
    timeout: 'The stream took too long to start.',
    codec: 'The stream uses a format that could not be played.',
    decode: 'The video could not be decoded.',
    proxy: 'The compatibility video engine could not start.',
    network: 'The connection to the stream was interrupted.',
    unknown: 'The stream could not be opened.'
  };
  return messages[code];
};
