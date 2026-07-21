import type { Channel } from '../types';
import { getChannelBaseName, normalizeKey } from './utils';

export interface DuplicateCandidate {
  signature: string;
  channelIds: string[];
  reason: 'tvg-id-group' | 'name-group';
}

/** Exact stream duplicates are safe to collapse; quality variants and review
 * candidates are kept intact so imports never discard user-visible data. */
export function collapseExactUrlDuplicates(channels: Channel[]): Channel[] {
  const seen = new Set<string>();
  return channels.filter(channel => {
    const url = channel.streamUrl.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

export function findDuplicateCandidates(channels: Channel[]): DuplicateCandidate[] {
  const groups = new Map<string, { ids: string[]; reason: DuplicateCandidate['reason'] }>();
  for (const channel of channels) {
    const group = normalizeKey(channel.groupTitle || '');
    const signature = channel.tvgId
      ? `tvg:${normalizeKey(channel.tvgId)}:${group}`
      : `name:${normalizeKey(getChannelBaseName(channel.name) || channel.name)}:${group}`;
    const reason = channel.tvgId ? 'tvg-id-group' : 'name-group';
    const found = groups.get(signature) || { ids: [], reason };
    found.ids.push(channel.id);
    groups.set(signature, found);
  }
  return [...groups.entries()]
    .filter(([, value]) => value.ids.length > 1)
    .map(([signature, value]) => ({ signature, channelIds: value.ids, reason: value.reason }));
}
