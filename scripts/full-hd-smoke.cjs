const http = require('http');
const net = require('net');
const tls = require('tls');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const MIN_PLAYBACK_SECONDS = 3;

function parseRawHttpHeaders(headerText) {
  const lines = headerText.split(/\r?\n/);
  const statusMatch = lines[0]?.match(/^HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const headers = {};

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    headers[key] = headers[key] ? `${headers[key]}\n${value}` : value;
  }

  return { statusCode, headers };
}

function firstHeaderValue(headers, name) {
  return (headers[name] || '').split('\n')[0].trim();
}

function rawRequest(urlText, minBytes = Infinity, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlText);
    const isHttps = parsedUrl.protocol === 'https:';
    const port = Number(parsedUrl.port || (isHttps ? 443 : 80));
    const requestPath = `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`;
    const hostHeader = parsedUrl.port ? `${parsedUrl.hostname}:${parsedUrl.port}` : parsedUrl.hostname;
    const socket = isHttps
      ? tls.connect({ host: parsedUrl.hostname, port, servername: parsedUrl.hostname })
      : net.createConnection({ host: parsedUrl.hostname, port });

    let headerBuffer = Buffer.alloc(0);
    let headersDone = false;
    let headerText = '';
    const chunks = [];
    let bytes = 0;

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Raw request timed out.'));
    }, timeoutMs);

    socket.once(isHttps ? 'secureConnect' : 'connect', () => {
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\n` +
        `Host: ${hostHeader}\r\n` +
        `User-Agent: IptvPlayerSmoke/1.0\r\n` +
        `Connection: close\r\n\r\n`
      );
    });

    socket.on('data', (chunk) => {
      if (!headersDone) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const headerEnd = headerBuffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;

        headersDone = true;
        headerText = headerBuffer.subarray(0, headerEnd).toString('latin1');
        const body = headerBuffer.subarray(headerEnd + 4);
        if (body.length > 0) {
          chunks.push(body);
          bytes += body.length;
        }
      } else {
        chunks.push(chunk);
        bytes += chunk.length;
      }

      if (bytes >= minBytes) {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ body: Buffer.concat(chunks), headerText });
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    socket.on('end', () => {
      clearTimeout(timeout);
      resolve({ body: Buffer.concat(chunks), headerText });
    });
  });
}

function startUpstreamRelay(sourceUrl) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_clientReq, clientRes) => {
      const pipeUrl = (currentUrl, redirectCount = 0) => {
        const upstreamUrl = new URL(currentUrl);
        const isHttps = upstreamUrl.protocol === 'https:';
        const port = Number(upstreamUrl.port || (isHttps ? 443 : 80));
        const requestPath = `${upstreamUrl.pathname || '/'}${upstreamUrl.search || ''}`;
        const hostHeader = upstreamUrl.port ? `${upstreamUrl.hostname}:${upstreamUrl.port}` : upstreamUrl.hostname;
        const upstreamSocket = isHttps
          ? tls.connect({ host: upstreamUrl.hostname, port, servername: upstreamUrl.hostname })
          : net.createConnection({ host: upstreamUrl.hostname, port });

        let headerBuffer = Buffer.alloc(0);
        let headersSent = false;

        const closeUpstream = () => {
          upstreamSocket.destroy();
        };

        clientRes.once('close', closeUpstream);
        upstreamSocket.once(isHttps ? 'secureConnect' : 'connect', () => {
          upstreamSocket.write(
            `GET ${requestPath} HTTP/1.1\r\n` +
            `Host: ${hostHeader}\r\n` +
            `User-Agent: IptvPlayerSmoke/1.0\r\n` +
            `Connection: close\r\n\r\n`
          );
        });

        upstreamSocket.on('data', (chunk) => {
          if (headersSent) {
            clientRes.write(chunk);
            return;
          }

          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          const headerEnd = headerBuffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) return;

          const responseMeta = parseRawHttpHeaders(headerBuffer.subarray(0, headerEnd).toString('latin1'));
          const location = firstHeaderValue(responseMeta.headers, 'location');
          if (responseMeta.statusCode >= 300 && responseMeta.statusCode < 400 && location && redirectCount < 5) {
            clientRes.removeListener('close', closeUpstream);
            upstreamSocket.destroy();
            pipeUrl(new URL(location, upstreamUrl).toString(), redirectCount + 1);
            return;
          }

          headersSent = true;
          clientRes.writeHead(200, { 'Content-Type': 'video/MP2T' });

          const body = headerBuffer.subarray(headerEnd + 4);
          if (body.length > 0) clientRes.write(body);
        });

        upstreamSocket.on('error', (error) => {
          clientRes.removeListener('close', closeUpstream);
          if (!clientRes.headersSent) clientRes.writeHead(502);
          clientRes.end();
          console.error(error.message || error);
        });

        upstreamSocket.on('end', () => {
          clientRes.removeListener('close', closeUpstream);
          clientRes.end();
        });
      };

      pipeUrl(sourceUrl);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/source` });
    });
  });
}

function writeCorsHeaders(response, extraHeaders = {}) {
  response.writeHead(extraHeaders.statusCode || 200, {
    ...(extraHeaders.headers || {}),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*'
  });
}

function startOutputRelay(vlcOutputUrl) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((clientReq, clientRes) => {
      if (clientReq.method === 'OPTIONS') {
        writeCorsHeaders(clientRes, { statusCode: 204 });
        clientRes.end();
        return;
      }

      const upstreamReq = http.get(vlcOutputUrl, (upstreamRes) => {
        writeCorsHeaders(clientRes, {
          statusCode: upstreamRes.statusCode || 200,
          headers: {
            'Content-Type': upstreamRes.headers['content-type'] || 'video/MP2T',
            'Cache-Control': 'no-cache'
          }
        });
        upstreamRes.pipe(clientRes);
      });

      upstreamReq.on('error', (error) => {
        if (!clientRes.headersSent) writeCorsHeaders(clientRes, { statusCode: 502 });
        clientRes.end();
        console.error(error.message || error);
      });

      clientRes.on('close', () => {
        upstreamReq.destroy();
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/stream` });
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function waitForTcpPort(port, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();
      let settled = false;

      const retry = () => {
        if (settled) return;
        settled = true;
        socket.destroy();

        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for TCP port ${port}.`));
          return;
        }

        setTimeout(tryConnect, 250);
      };

      socket.setTimeout(500);
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve();
      });
      socket.once('timeout', retry);
      socket.once('error', retry);
      socket.connect(port, '127.0.0.1');
    };

    tryConnect();
  });
}

async function selectFullHdStream(playlistUrl, channelMatch) {
  const playlist = (await rawRequest(playlistUrl)).body.toString('utf8');
  const lines = playlist.split(/\r?\n/);
  const normalizedMatch = channelMatch.toLowerCase();

  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].toLowerCase().includes(normalizedMatch)) {
      return {
        title: lines[i].split(',').pop().trim(),
        url: lines[i + 1].trim()
      };
    }
  }

  throw new Error('No Full HD stream found in playlist.');
}

async function runDriver() {
  const playlistUrl = process.env.IPTV_SMOKE_PLAYLIST_URL;
  if (!playlistUrl) {
    throw new Error('Set IPTV_SMOKE_PLAYLIST_URL before running this smoke test.');
  }

  const stream = await selectFullHdStream(playlistUrl, process.env.IPTV_SMOKE_CHANNEL_MATCH || 'Full HD');
  console.log(`Testing channel: ${stream.title}`);

  const relay = await startUpstreamRelay(stream.url);
  const outputPort = await getFreePort();
  const helperPath = path.join(__dirname, '..', 'native-runtime', 'win-x64', 'libvlc-proxy', 'LibVlcProxyHelper.exe');
  const helper = spawn(helperPath, [], {
    cwd: path.dirname(helperPath),
    env: {
      ...process.env,
      IPTV_PROXY_SOURCE_URL: relay.url,
      IPTV_PROXY_PORT: String(outputPort)
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  helper.stdout.on('data', (data) => process.stdout.write(`[helper stdout] ${data}`));
  helper.stderr.on('data', (data) => process.stdout.write(`[helper stderr] ${data}`));

  await waitForTcpPort(outputPort);
  const outputRelay = await startOutputRelay(`http://127.0.0.1:${outputPort}/stream`);
  const electronPath = require('electron');
  const child = spawn(electronPath, [__filename], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      IPTV_SMOKE_PROXY_URL: outputRelay.url,
      IPTV_SMOKE_CHANNEL_TITLE: stream.title
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => {
    stdout += data.toString();
    process.stdout.write(data);
  });
  child.stderr.on('data', (data) => {
    stderr += data.toString();
    process.stderr.write(data);
  });

  try {
    const exitCode = await new Promise((resolve) => child.once('exit', resolve));
    if (exitCode !== 0) {
      throw new Error(`Electron smoke failed with exit code ${exitCode}. ${stderr || stdout}`);
    }
  } finally {
    child.kill();
    helper.kill();
    outputRelay.server.close();
    relay.server.close();
  }
}

async function runElectronPlaybackTest() {
  const { app, BrowserWindow } = require('electron');
  const proxyUrl = process.env.IPTV_SMOKE_PROXY_URL;
  const screenshotPath = process.env.IPTV_SMOKE_SCREENSHOT_PATH;
  const mpegtsSource = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'mpegts.js', 'dist', 'mpegts.js'), 'utf8');

  await app.whenReady();

  const window = new BrowserWindow({
    show: process.env.IPTV_SMOKE_SHOW === '1',
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <body style="margin:0;background:#000;overflow:hidden">
      <video id="video" muted autoplay playsinline style="width:100vw;height:100vh;object-fit:contain;background:#000"></video>
    </body>
  `)}`);

  const result = await window.webContents.executeJavaScript(`
    ${mpegtsSource}
    new Promise((resolve) => {
      const video = document.getElementById('video');
      const captureFrame = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let total = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          total += pixels[i] + pixels[i + 1] + pixels[i + 2];
        }
        return {
          framePng: canvas.toDataURL('image/png'),
          frameMean: total / (canvas.width * canvas.height * 3)
        };
      };

      const player = mpegts.createPlayer({ type: 'mpegts', url: ${JSON.stringify(proxyUrl)}, isLive: true }, {
        enableStashBuffer: true,
        stashInitialSize: 2097152,
        lazyLoad: false,
        liveBufferLatencyChasing: false
      });

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        try { player.destroy(); } catch {}
        resolve(value);
      };

      player.on(mpegts.Events.ERROR, (type, detail, info) => {
        finish({ ok: false, reason: 'mpegts-error', type, detail, info });
      });

      video.addEventListener('playing', () => {
        setTimeout(() => {
          const frame = captureFrame();
          finish({
            ok: video.currentTime >= ${MIN_PLAYBACK_SECONDS - 0.5},
            reason: 'playing',
            currentTime: video.currentTime,
            width: video.videoWidth,
            height: video.videoHeight,
            readyState: video.readyState,
            frameMean: frame.frameMean,
            framePng: frame.framePng
          });
        }, ${MIN_PLAYBACK_SECONDS * 1000});
      }, { once: true });

      setTimeout(() => {
        finish({
          ok: false,
          reason: 'timeout',
          currentTime: video.currentTime,
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState
        });
      }, 30000);

      player.attachMediaElement(video);
      player.load();
      player.play().catch((error) => {
        finish({ ok: false, reason: 'play-promise', message: error?.message || String(error) });
      });
    });
  `);

  const logResult = { ...result };
  if (logResult.framePng) {
    logResult.framePng = '<png>';
  }
  console.log(`SMOKE_RESULT ${JSON.stringify(logResult)}`);
  if (screenshotPath && result.framePng) {
    const base64 = result.framePng.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(screenshotPath, Buffer.from(base64, 'base64'));
    console.log(`SMOKE_SCREENSHOT ${screenshotPath}`);
  }
  app.quit();
  process.exit(result.ok ? 0 : 1);
}

if (process.versions.electron) {
  runElectronPlaybackTest().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  runDriver().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
