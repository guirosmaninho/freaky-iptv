import assert from 'node:assert/strict';
import test from 'node:test';
import { configureParserWorker, parseUsingWorker } from '../src/services/parserWorkerClient';
import type { ParserRequest, ParserResponse } from '../src/services/parserWorkerClient';
import type { M3UPlaylist } from '../src/types';

function fixture() {
  let terminated = 0;
  let sent: ParserRequest | null = null;
  const worker = {
    onmessage: null as ((event: MessageEvent<ParserResponse>) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage(request: ParserRequest) { sent = request; },
    terminate() { terminated++; }
  };
  configureParserWorker(() => worker as unknown as Worker);
  return { worker, terminated: () => terminated, sent: () => sent };
}

test('leaves synchronous parsing available in runtimes without a configured worker', () => {
  assert.equal(parseUsingWorker({ kind: 'epg', text: '<tv/>' }), null);
});

test('returns parsed data and terminates the parser after success', async () => {
  const parser = fixture();
  const request: ParserRequest = { kind: 'm3u', text: '#EXTM3U', sourceHash: 'source' };
  const value: M3UPlaylist = { channels: [], issues: [], sourceUrlHash: 'source', importedAtUtc: '2026-10-22T00:00:00Z' };
  const result = parseUsingWorker(request);
  assert.deepEqual(parser.sent(), request);
  parser.worker.onmessage?.({ data: { ok: true, value } } as MessageEvent<ParserResponse>);
  assert.deepEqual(await result, value);
  assert.equal(parser.terminated(), 1);
});

test('invalid source data rejects without returning a partial guide', async () => {
  const parser = fixture();
  const result = parseUsingWorker({ kind: 'epg', text: '<bad>' });
  parser.worker.onmessage?.({ data: { ok: false, error: 'XML parsing error' } } as MessageEvent<ParserResponse>);
  await assert.rejects(result!, /XML parsing error/);
  assert.equal(parser.terminated(), 1);
});

test('worker failures terminate the job and leave later imports usable', async () => {
  const parser = fixture();
  const result = parseUsingWorker({ kind: 'epg', text: '<tv/>' });
  parser.worker.onerror?.();
  await assert.rejects(result!, /Unable to parse/);
  assert.equal(parser.terminated(), 1);
  const next = fixture();
  const retried = parseUsingWorker({ kind: 'epg', text: '<tv/>' });
  next.worker.onmessage?.({ data: { ok: false, error: 'retry reached parser' } } as MessageEvent<ParserResponse>);
  await assert.rejects(retried!, /retry reached parser/);
});
