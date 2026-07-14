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
