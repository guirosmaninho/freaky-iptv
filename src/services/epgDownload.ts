import type { EpgGuide } from '../types';
import { downloadText } from './downloadText';
import { parseUsingWorker } from './parserWorkerClient';

export async function downloadAndParseEPG(epgUrl: string, progressCallback?: (status: string) => void): Promise<EpgGuide> {
  progressCallback?.('Downloading TV guide...');
  const text = await downloadText(epgUrl, 'Failed to download EPG');
  progressCallback?.('Parsing TV guide...');
  const pending = parseUsingWorker<EpgGuide>({ kind: 'epg', text });
  if (pending) return pending;
  const { parseEPG } = await import('./epgParser');
  return parseEPG(text);
}
