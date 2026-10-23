import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';

type StreamingResponse = http.IncomingMessage & { finalUrl?: string };
type OpenStreamingHttpRequest = (
  url: string,
  options: {
    allowPrivateNetwork: boolean;
    timeoutMs?: number;
    resolveTarget: (hostname: string, allowPrivateNetwork: boolean) => Promise<{ address: string; family: number }>;
  }
) => Promise<StreamingResponse>;

const relayCore = (() => {
  try {
    const requireFromProject = createRequire(join(process.cwd(), 'package.json'));
    return requireFromProject(join(process.cwd(), 'electron', 'streamingHttpCore.cjs')) as { openStreamingHttpRequest?: OpenStreamingHttpRequest };
  } catch {
    return {} as { openStreamingHttpRequest?: OpenStreamingHttpRequest };
  }
})();

describe('streaming HTTP relay', () => {
  it('forwards a decoded chunked response body without HTTP chunk markers', async () => {
    assert.equal(
      typeof relayCore.openStreamingHttpRequest,
      'function',
      'the relay needs a streaming HTTP client that decodes Transfer-Encoding: chunked'
    );

    const payload = Buffer.concat([
      Buffer.from([0x47, 0x40, 0x00, 0x10]),
      Buffer.alloc(184, 0x11),
      Buffer.from([0x47, 0x40, 0x01, 0x10]),
      Buffer.alloc(184, 0x22)
    ]);
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'video/MP2T', 'Transfer-Encoding': 'chunked' });
      response.write(payload.subarray(0, 119));
      response.end(payload.subarray(119));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    try {
      const response = await relayCore.openStreamingHttpRequest!(
        `http://iptv.example.test:${address.port}/live`,
        {
          allowPrivateNetwork: true,
          resolveTarget: async () => ({ address: '127.0.0.1', family: 4 })
        }
      );
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.from(chunk));

      assert.deepEqual(Buffer.concat(chunks), payload);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('uses the decoded streaming client for the shared playback relay', () => {
    const source = readFileSync(join(process.cwd(), 'main.cjs'), 'utf8');
    const relaySource = source.match(/function startPlaybackRelayUpstream\(relay,[\s\S]*?\n\}/)?.[0] || '';

    assert.match(relaySource, /openStreamingHttpRequest\(/);
  });
});

describe('provider HTTP framing compatibility', () => {
  async function withRawResponse(raw: string | Buffer | ((socket: import('node:net').Socket) => void), check: (url: string) => Promise<void>) {
    const net = await import('node:net');
    const sockets = new Set<import('node:net').Socket>();
    const server = net.createServer(socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.once('data', () => { if (typeof raw === 'function') raw(socket); else socket.end(raw); });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try { await check(`http://provider.example.test:${address.port}/source`); }
    finally { for (const socket of sockets) socket.destroy(); server.close(); await once(server, 'close'); }
  }
  const options = {
    allowPrivateNetwork: true,
    resolveTarget: async () => ({ address: '127.0.0.1', family: 4 })
  };

  it('accepts identical Content-Length fields without a second request', async () => {
    await withRawResponse('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nContent-Length: 7\r\nConnection: close\r\n\r\n#EXTM3U', async url => {
      const response = await relayCore.openStreamingHttpRequest!(url, options);
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), '#EXTM3U');
      assert.equal(response.headers['content-length'], '7');
    });
  });

  it('accepts an identical comma-separated length list', async () => {
    await withRawResponse('HTTP/1.1 200 OK\r\nContent-Length: 7, 7\r\nConnection: close\r\n\r\n#EXTM3U', async url => {
      const response = await relayCore.openStreamingHttpRequest!(url, options);
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), '#EXTM3U');
    });
  });

  for (const [name, headers] of [
    ['conflicting lengths', 'Content-Length: 7\r\nContent-Length: 8'],
    ['invalid lengths', 'Content-Length: 7x\r\nContent-Length: 7x'],
    ['ambiguous chunked framing', 'Transfer-Encoding: chunked\r\nContent-Length: 7\r\nContent-Length: 7']
  ]) {
    it(`rejects ${name}`, async () => {
      await withRawResponse(`HTTP/1.1 200 OK\r\n${headers}\r\nConnection: close\r\n\r\n#EXTM3U`, async url => {
        await assert.rejects(() => relayCore.openStreamingHttpRequest!(url, options));
      });
    });
  }
  it('normalizes fragmented headers after an informational response', async () => {
    await withRawResponse(socket => {
      socket.write('HTTP/1.1 103 Early Hints\r\nLink: </asset>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Len');
      setImmediate(() => socket.end('gth: 7\r\nContent-Length: 007\r\n\r\n#EXTM3U'));
    }, async url => {
      const response = await relayCore.openStreamingHttpRequest!(url, options);
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.from(chunk));
      assert.equal(Buffer.concat(chunks).toString(), '#EXTM3U');
    });
  });

  it('preserves compressed payload bytes while normalizing headers', async () => {
    const { gzipSync, gunzipSync } = await import('node:zlib');
    const body = gzipSync('Televisão — notícia');
    await withRawResponse(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${body.length}\r\nContent-Length: ${body.length}\r\n\r\n`), body]), async url => {
      const response = await relayCore.openStreamingHttpRequest!(url, options);
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(Buffer.from(chunk));
      assert.equal(gunzipSync(Buffer.concat(chunks)).toString(), 'Televisão — notícia');
    });
  });

  it('still rejects a truncated fixed-length body', async () => {
    await withRawResponse('HTTP/1.1 200 OK\r\nContent-Length: 12\r\nContent-Length: 12\r\n\r\nshort', async url => {
      await assert.rejects(async () => {
        const response = await relayCore.openStreamingHttpRequest!(url, options);
        for await (const chunk of response) void chunk;
      });
    });
  });

  it('streams a large response correctly under consumer backpressure', async () => {
    const body = Buffer.alloc(2 * 1024 * 1024, 0x47);
    await withRawResponse(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nContent-Length: ${body.length}\r\n\r\n`), body]), async url => {
      const response = await relayCore.openStreamingHttpRequest!(url, options);
      const chunks: Buffer[] = [];
      for await (const chunk of response) {
        chunks.push(Buffer.from(chunk));
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.deepEqual(Buffer.concat(chunks), body);
    });
  });

  it('times out when a server connects but sends no headers', async () => {
    await withRawResponse(() => {}, async url => {
      await assert.rejects(() => relayCore.openStreamingHttpRequest!(url, { ...options, timeoutMs: 100 }), /Timed out/);
    });
  });
  it('rejects malformed redirects without throwing outside the request promise', async () => {
    await withRawResponse('HTTP/1.1 302 Found\r\nLocation: http://[\r\nContent-Length: 0\r\n\r\n', async url => {
      let timer: ReturnType<typeof setTimeout>;
      try {
        await assert.rejects(() => Promise.race([
          relayCore.openStreamingHttpRequest!(url, options),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Redirect promise was left pending')), 300); })
        ]), /Invalid redirect URL/);
      } finally { clearTimeout(timer!); }
    });
  });

});
