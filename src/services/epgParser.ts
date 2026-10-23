import { SaxesParser } from 'saxes';
import type { EpgGuide, EPGProgram, ParserIssue, Channel } from '../types';
import { normalizeKey } from './utils';

// Only http(s) icon URLs are kept: an untrusted XMLTV document must not be
// able to smuggle javascript:/data: URLs into the renderer.
function sanitizeIconUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export { downloadAndParseEPG } from './epgDownload';

/** Parse XMLTV once, without constructing a second in-memory XML document. */
export function parseEPG(xmlText: string): EpgGuide {
  const issues: ParserIssue[] = [];
  // Source identifiers are untrusted, including names such as __proto__.
  const displayNames: Record<string, string> = Object.create(null);
  const normalizedNames: Record<string, string> = Object.create(null);
  const programsByChannel: Record<string, EPGProgram[]> = Object.create(null);
  type Entry = {
    kind: 'channel' | 'programme';
    depth: number;
    index: number;
    attributes: Record<string, string>;
    fields: Record<string, string>;
  };
  let entry: Entry | null = null;
  let field: { name: string; depth: number; text: string } | null = null;
  let depth = 0;
  let channelIndex = 0;
  let programmeIndex = 0;
  const textFields = new Set(['display-name', 'title', 'sub-title', 'desc', 'category']);
  const parser = new SaxesParser({ xmlns: false });

  const finishEntry = (value: Entry) => {
    const { attributes, fields, index } = value;
    const issue = (message: string) => issues.push({ sourceType: 'XMLTV', lineNumber: index + 1, message });
    if (value.kind === 'channel') {
      const id = attributes.id?.trim();
      if (!id) { issue(`Channel node at index ${index} has no id.`); return; }
      if (Object.hasOwn(displayNames, id)) {
        issue(`Duplicate XMLTV channel id '${id}' encountered; first display name is kept.`);
        return;
      }
      const name = fields['display-name']?.trim() || id;
      displayNames[id] = name;
      const normalized = normalizeKey(name);
      if (normalized && !Object.hasOwn(normalizedNames, normalized)) normalizedNames[normalized] = id;
      return;
    }
    const channelId = attributes.channel?.trim() || '';
    if (!channelId) { issue(`Programme at index ${index} has no channel id.`); return; }
    const rawStart = attributes.start?.trim() || '';
    const rawStop = attributes.stop?.trim() || '';
    const start = parseXmlTvDate(rawStart);
    const stop = parseXmlTvDate(rawStop);
    if (!start || !stop || stop <= start) {
      issue(`Programme at index ${index} has invalid start/stop timestamps.`);
      return;
    }
    (programsByChannel[channelId] ||= []).push({
      channelId,
      title: fields.title?.trim() || 'Untitled programme',
      subTitle: fields['sub-title']?.trim() || '',
      description: fields.desc?.trim() || '',
      category: fields.category?.trim() || '',
      iconUrl: sanitizeIconUrl(fields.icon?.trim() || ''),
      startUtc: start, stopUtc: stop, rawStart, rawStop
    });
  };

  parser.on('opentag', tag => {
    if (depth === 0 && tag.name !== 'tv') throw new Error('Expected an XMLTV tv root element.');
    depth++;
    if (!entry && (tag.name === 'channel' || tag.name === 'programme')) {
      entry = {
        kind: tag.name, depth, attributes: tag.attributes, fields: Object.create(null),
        index: tag.name === 'channel' ? channelIndex++ : programmeIndex++
      };
    } else if (entry && !field && !Object.hasOwn(entry.fields, tag.name)) {
      if (textFields.has(tag.name)) field = { name: tag.name, depth, text: '' };
      else if (tag.name === 'icon') entry.fields.icon = tag.attributes.src || '';
    }
  });
  const appendText = (text: string) => { if (field) field.text += text; };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    if (field?.depth === depth && entry) {
      entry.fields[field.name] = field.text;
      field = null;
    }
    if (entry?.depth === depth) { finishEntry(entry); entry = null; }
    depth--;
  });
  // Saxes rejects malformed entities, invalid characters and trailing content.
  // It does not fetch DTDs or resolve external entities.
  try { parser.write(xmlText).close(); }
  catch (error) { throw new Error(`XML parsing error: ${error instanceof Error ? error.message : 'invalid XMLTV document'}`, { cause: error }); }

  for (const programs of Object.values(programsByChannel)) {
    programs.sort((a, b) => a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0);
  }
  return { programsByChannel, displayNames, normalizedNames, issues };
}

export function parseXmlTvDate(value: string): string | null {
  if (!value) return null;
  
  // Format: yyyyMMddHHmmss [+-]HHmm or yyyyMMddHHmmss Z
  const match = value.trim().match(/^(\d{14})(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/i);
  if (!match) return null;
  
  const dateStr = match[1];
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6)) - 1; // 0-based month in JS
  const day = parseInt(dateStr.slice(6, 8));
  const hour = parseInt(dateStr.slice(8, 10));
  const min = parseInt(dateStr.slice(10, 12));
  const sec = parseInt(dateStr.slice(12, 14));
  
  const offsetStr = match[2];
  
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) {
    return null;
  }

  const hasValidCalendarDate = (utcMs: number) => {
    const date = new Date(utcMs);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day &&
      date.getUTCHours() === hour && date.getUTCMinutes() === min && date.getUTCSeconds() === sec;
  };

  if (!offsetStr || offsetStr.toUpperCase() === 'Z') {
    if (!offsetStr) {
      // No offset, treat as local time
      const date = new Date(year, month, day, hour, min, sec);
      if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day ||
        date.getHours() !== hour || date.getMinutes() !== min || date.getSeconds() !== sec) return null;
      return date.toISOString();
    } else {
      // Z means UTC
      const utcMs = Date.UTC(year, month, day, hour, min, sec);
      if (!hasValidCalendarDate(utcMs)) return null;
      const date = new Date(utcMs);
      return date.toISOString();
    }
  }
  
  // Parse offset: +0100, -0500, +01:00
  const cleanOffset = offsetStr.replace(':', '');
  const sign = cleanOffset[0] === '-' ? -1 : 1;
  const offsetHours = parseInt(cleanOffset.slice(1, 3));
  const offsetMins = parseInt(cleanOffset.slice(3, 5)) || 0;
  if (offsetHours > 14 || offsetMins > 59 || (offsetHours === 14 && offsetMins !== 0)) return null;
  
  const utcTime = Date.UTC(year, month, day, hour, min, sec);
  if (!hasValidCalendarDate(utcTime)) return null;
  const offsetMs = sign * (offsetHours * 60 + offsetMins) * 60 * 1000;
  const adjustedTime = utcTime - offsetMs;
  
  return new Date(adjustedTime).toISOString();
}

export function findProgramsForChannel(channel: Channel, guide: EpgGuide): EPGProgram[] {
  // 1. Try to find by tvg-id
  if (channel.tvgId && guide.programsByChannel[channel.tvgId]) {
    return guide.programsByChannel[channel.tvgId];
  }
  
  // 2. Try to find by normalized channel name
  const normalized = normalizeKey(channel.name);
  const guideChannelId = guide.normalizedNames[normalized];
  if (guideChannelId && guide.programsByChannel[guideChannelId]) {
    return guide.programsByChannel[guideChannelId];
  }
  
  return [];
}
