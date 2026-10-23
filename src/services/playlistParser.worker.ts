import { parseEPG } from './epgParser';
import { parseM3U } from './m3uParser';
import type { ParserRequest, ParserResponse } from './parserWorkerClient';

self.onmessage = (event: MessageEvent<ParserRequest>) => {
  try {
    const request = event.data;
    const value = request.kind === 'm3u'
      ? parseM3U(request.text, request.sourceHash)
      : parseEPG(request.text);
    self.postMessage({ ok: true, value } satisfies ParserResponse);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Unable to parse the source.' } satisfies ParserResponse);
  }
};
