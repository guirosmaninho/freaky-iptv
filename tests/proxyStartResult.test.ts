import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeProxyStartResult } from '../src/services/proxyStartResult';

describe('proxy start IPC compatibility', () => {
  it('accepts the legacy URL response used by a main process during renderer HMR', () => {
    assert.deepEqual(normalizeProxyStartResult('http://127.0.0.1:1234/stream'), {
      ok: true,
      url: 'http://127.0.0.1:1234/stream'
    });
  });

  it('keeps structured success and failure responses', () => {
    assert.deepEqual(normalizeProxyStartResult({ ok: true, url: 'http://127.0.0.1:5678/stream' }), {
      ok: true,
      url: 'http://127.0.0.1:5678/stream'
    });
    assert.deepEqual(normalizeProxyStartResult({ ok: false, errorCode: 'proxy', error: 'Unavailable' }), {
      ok: false,
      errorCode: 'proxy',
      error: 'Unavailable'
    });
  });

  it('rejects missing or non-HTTP proxy URLs', () => {
    assert.equal(normalizeProxyStartResult(null).ok, false);
    assert.equal(normalizeProxyStartResult('file:///tmp/video').ok, false);
  });
});
