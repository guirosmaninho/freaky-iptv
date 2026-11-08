import type { Channel, EPGProgram, EpgGuide } from '../types';
import { getChannelBaseName, normalizeKey } from './utils';

const EMPTY_PROGRAMS: EPGProgram[] = [];

// A plus sign can be part of a channel's identity (e.g. Canal vs Canal+).
// Normalize quality markers on each side separately so it is not discarded.
const channelIdentity = (name: string, qualityMappings?: Record<string, string>) => name
  .split('+')
  .map(part => normalizeKey(getChannelBaseName(part, qualityMappings)))
  .join('+');

// A descriptive ID such as sporttv1.pt can corroborate the XMLTV display
// name when the playlist also gives that ID to an unrelated entry.
function matchesConflictingGuideId(name: string, id: string, displayName: string | undefined, qualityMappings?: Record<string, string>) {
  const scopedId = /^([\w+-]+)\.([a-z]{2})$/i.exec(id);
  if (!scopedId || !displayName) return false;

  const [, idName, country] = scopedId;
  const expectedIdentity = channelIdentity(idName, qualityMappings);
  if (!expectedIdentity) return false;

  return [name, displayName].every(label => {
    const labelCountry = /^([a-z]{2})\s*[:|-]/i.exec(label)?.[1];
    if (labelCountry && labelCountry.toLowerCase() !== country.toLowerCase()) return false;
    return channelIdentity(label.replace(/\s+(?:hq|\(hq\))\s*$/i, ''), qualityMappings) === expectedIdentity;
  });
}

/** Index programmes for channels and their playable quality variants. */
export function buildChannelProgramLookup(channels: Channel[], guide: EpgGuide, qualityMappings?: Record<string, string>) {
  const programs = new Map<string, EPGProgram[]>();
  const ambiguousIds = new Set<string>();
  const namesByGuideId = new Map<string, Set<string>>();

  for (const channel of channels) {
    for (const variant of [channel, ...(channel.variants || [])]) {
      if (!variant.tvgId) continue;
      const name = channelIdentity(variant.name, qualityMappings);
      if (!name) continue;
      const names = namesByGuideId.get(variant.tvgId) || new Set<string>();
      names.add(name);
      namesByGuideId.set(variant.tvgId, names);
    }
  }

  const conflictingGuideIds = new Set(
    [...namesByGuideId].filter(([, names]) => names.size > 1).map(([id]) => id)
  );

  for (const channel of channels) {
    const variants = [channel, ...(channel.variants || [])];
    let result: EPGProgram[] | undefined;
    let foundConflict = false;
    for (const variant of variants) {
      if (variant.tvgId && guide.programsByChannel[variant.tvgId]) {
        if (conflictingGuideIds.has(variant.tvgId) && !matchesConflictingGuideId(
          variant.name, variant.tvgId, guide.displayNames[variant.tvgId], qualityMappings
        )) {
          foundConflict = true;
          continue;
        }
        result = guide.programsByChannel[variant.tvgId];
        break;
      }
    }
    if (!result) {
      for (const variant of variants) {
        const id = guide.normalizedNames[normalizeKey(variant.name)];
        if (id && guide.programsByChannel[id]) {
          if (conflictingGuideIds.has(id)) {
            foundConflict = true;
            continue;
          }
          result = guide.programsByChannel[id];
          break;
        }
      }
    }
    for (const variant of variants) {
      programs.set(variant.id, result || EMPTY_PROGRAMS);
      if (!result && foundConflict) ambiguousIds.add(variant.id);
    }
  }
  return { programs, ambiguousIds };
}
