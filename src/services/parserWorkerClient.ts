import type { EpgGuide, M3UPlaylist } from '../types';

export type ParserRequest = { kind: 'm3u'; text: string; sourceHash: string } | { kind: 'epg'; text: string };
export type ParserResponse = { ok: true; value: M3UPlaylist | EpgGuide } | { ok: false; error: string };
let createWorker: (() => Worker) | null = null;

/** Keep the bundler-specific URL in the renderer entry point. */
export function configureParserWorker(factory: () => Worker): void {
  createWorker = factory;
}

export function parseUsingWorker<T extends M3UPlaylist | EpgGuide>(request: ParserRequest): Promise<T> | null {
  if (!createWorker) return null;
  const worker = createWorker();
  return new Promise<T>((resolve, reject) => {
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('Parsing timed out. Try a smaller source.'));
    }, 120_000);
    worker.onmessage = (event: MessageEvent<ParserResponse>) => {
      finish();
      if (event.data.ok) resolve(event.data.value as T);
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => { finish(); reject(new Error('Unable to parse the source.')); };
    worker.onmessageerror = () => { finish(); reject(new Error('Unable to read the parsed source.')); };
    try { worker.postMessage(request); }
    catch (error) { finish(); reject(error); }
  });
}
