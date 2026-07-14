const http = require('node:http');
const https = require('node:https');

function openStreamingHttpRequest(urlText, {
  allowPrivateNetwork = false,
  maxRedirects = 5,
  redirectCount = 0,
  resolveTarget,
  timeoutMs = 30_000,
  userAgent = 'VLC/3.0.18 LibVLC/3.0.18'
} = {}) {
  if (typeof resolveTarget !== 'function') {
    return Promise.reject(new TypeError('resolveTarget must be provided.'));
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlText);
  } catch {
    return Promise.reject(new Error('Invalid URL.'));
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return Promise.reject(new Error('Unsupported URL protocol.'));
  }

  return Promise.resolve(resolveTarget(parsedUrl.hostname, allowPrivateNetwork)).then(target => new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const basicAuth = parsedUrl.username
      ? `Basic ${Buffer.from(`${decodeURIComponent(parsedUrl.username)}:${decodeURIComponent(parsedUrl.password)}`).toString('base64')}`
      : null;
    const request = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: '*/*',
        Connection: 'keep-alive',
        ...(basicAuth ? { Authorization: basicAuth } : {})
      },
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options?.all) {
          callback(null, [{ address: target.address, family: target.family }]);
          return;
        }
        callback(null, target.address, target.family);
      }
    }, response => {
      const statusCode = response.statusCode || 0;
      const location = typeof response.headers.location === 'string' ? response.headers.location : undefined;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= maxRedirects) {
          reject(new Error('Too many redirects.'));
          return;
        }
        const nextUrl = new URL(location, parsedUrl);
        if (nextUrl.origin !== parsedUrl.origin) {
          nextUrl.username = '';
          nextUrl.password = '';
        }
        resolve(openStreamingHttpRequest(nextUrl.toString(), {
          allowPrivateNetwork,
          maxRedirects,
          redirectCount: redirectCount + 1,
          resolveTarget,
          timeoutMs,
          userAgent
        }));
        return;
      }

      response.finalUrl = parsedUrl.toString();
      resolve(response);
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error('Timed out opening stream.')));
    request.once('error', reject);
    request.end();
  }));
}

module.exports = { openStreamingHttpRequest };
