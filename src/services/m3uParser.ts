import type { Channel, ParserIssue, M3UPlaylist } from '../types';
import { downloadText } from './downloadText';
import { sha256Short, normalizeKey } from './utils';

export async function downloadAndParseM3U(
  playlistUrl: string,
  progressCallback?: (status: string) => void
): Promise<M3UPlaylist> {
  if (progressCallback) progressCallback('Downloading playlist...');
  
  const text = await downloadText(playlistUrl, 'Failed to download playlist');
  const sourceHash = sha256Short(playlistUrl);
  
  if (progressCallback) progressCallback('Parsing playlist...');
  return parseM3U(text, sourceHash);
}

export function parseM3U(text: string, sourceUrlHash: string): M3UPlaylist {
  const channels: Channel[] = [];
  const issues: ParserIssue[] = [];
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  
  let pendingExtInf: string | null = null;
  let pendingExtInfLine = 0;
  let lineNumber = 0;
  
  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.trim();
    if (line.length === 0) continue;
    
    if (line.toUpperCase().startsWith('#EXTINF')) {
      pendingExtInf = line;
      pendingExtInfLine = lineNumber;
      continue;
    }
    
    if (line.startsWith('#')) {
      continue;
    }
    
    if (pendingExtInf === null) {
      issues.push({
        sourceType: 'M3U',
        lineNumber,
        message: 'Stream URL found without preceding EXTINF metadata.'
      });
      continue;
    }
    
    const parsed = parseChannel(pendingExtInf, line, pendingExtInfLine, issues);
    if (parsed) {
      channels.push(parsed);
    }
    
    pendingExtInf = null;
    pendingExtInfLine = 0;
  }
  
  if (pendingExtInf !== null) {
    issues.push({
      sourceType: 'M3U',
      lineNumber: pendingExtInfLine,
      message: 'EXTINF metadata was not followed by a stream URL.'
    });
  }
  
  return {
    sourceUrlHash,
    importedAtUtc: new Date().toISOString(),
    channels,
    issues
  };
}

function parseChannel(
  extInf: string,
  streamUrl: string,
  lineNumber: number,
  issues: ParserIssue[]
): Channel | null {
  // Validate Stream URL
  let streamUri: URL;
  try {
    streamUri = new URL(streamUrl);
    if (streamUri.protocol !== 'http:' && streamUri.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
  } catch {
    issues.push({
      sourceType: 'M3U',
      lineNumber,
      message: 'Invalid or unsupported stream URL.'
    });
    return null;
  }
  
  const colonIndex = extInf.indexOf(':');
  if (colonIndex < 0) {
    issues.push({
      sourceType: 'M3U',
      lineNumber,
      message: 'EXTINF tag is missing metadata separator.'
    });
    return null;
  }
  
  const metadata = extInf.slice(colonIndex + 1);
  const commaIndex = findCommaOutsideQuotes(metadata);
  
  let displayName = '';
  const header = commaIndex >= 0 ? metadata.slice(0, commaIndex).trim() : metadata.trim();
  if (commaIndex >= 0) {
    displayName = metadata.slice(commaIndex + 1).trim();
  } else {
    issues.push({
      sourceType: 'M3U',
      lineNumber,
      message: 'EXTINF tag is missing channel name separator.'
    });
  }
  
  const { duration, remainingHeader } = parseDuration(header);
  const attributes = parseAttributes(remainingHeader, lineNumber, issues);
  
  const tvgId = (attributes['tvg-id'] || '').trim();
  const tvgName = (attributes['tvg-name'] || '').trim();
  const logo = (attributes['tvg-logo'] || '').trim();
  const group = (attributes['group-title'] || '').trim();
  
  const name = firstNonEmpty(displayName, tvgName, tvgId, streamUri.hostname);
  if (!name) {
    issues.push({
      sourceType: 'M3U',
      lineNumber,
      message: 'Channel has no usable name.'
    });
    return null;
  }
  
  const idSeed = tvgId
    ? `${tvgId}|${streamUrl}`
    : `${normalizeKey(name)}|${streamUrl}`;
     
  const id = sha256Short(idSeed);
  
  let logoUrl = '';
  try {
    if (logo) {
      const parsedLogo = new URL(logo);
      logoUrl = parsedLogo.toString();
    }
  } catch {
    // Ignore invalid logo URL
  }
  
  return {
    id,
    tvgId,
    name,
    logoUrl,
    groupTitle: group || 'Uncategorized',
    streamUrl: streamUri.toString(),
    duration,
    attributes
  };
}

function findCommaOutsideQuotes(value: string): number {
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === ',' && !inQuotes) {
      return i;
    }
  }
  return -1;
}

function parseDuration(header: string): { duration: number; remainingHeader: string } {
  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return { duration: -1, remainingHeader: '' };
  }
  
  let end = 0;
  while (end < trimmed.length && !/\s/.test(trimmed[end])) {
    end++;
  }
  
  const token = trimmed.slice(0, end);
  const duration = parseFloat(token);
  if (!isNaN(duration)) {
    return { duration, remainingHeader: trimmed.slice(end).trim() };
  }
  
  return { duration: -1, remainingHeader: trimmed };
}

function parseAttributes(value: string, lineNumber: number, issues: ParserIssue[]): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  
  while (i < value.length) {
    while (i < value.length && /\s/.test(value[i])) {
      i++;
    }
    
    const keyStart = i;
    while (i < value.length && !/\s/.test(value[i]) && value[i] !== '=') {
      i++;
    }
    
    if (keyStart === i) {
      i++;
      continue;
    }
    
    const key = value.slice(keyStart, i).trim().toLowerCase();
    while (i < value.length && /\s/.test(value[i])) {
      i++;
    }
    
    if (i >= value.length || value[i] !== '=') {
      while (i < value.length && !/\s/.test(value[i])) {
        i++;
      }
      continue;
    }
    
    i++; // Skip '='
    while (i < value.length && /\s/.test(value[i])) {
      i++;
    }
    
    let attributeValue: string;
    if (i < value.length && value[i] === '"') {
      i++; // Skip leading quote
      const valueStart = i;
      while (i < value.length && value[i] !== '"') {
        i++;
      }
      
      attributeValue = value.slice(valueStart, i);
      if (i < value.length && value[i] === '"') {
        i++;
      } else {
        issues.push({
          sourceType: 'M3U',
          lineNumber,
          message: `Attribute '${key}' has an unclosed quote.`
        });
      }
    } else {
      const valueStart = i;
      while (i < value.length && !/\s/.test(value[i])) {
        i++;
      }
      attributeValue = value.slice(valueStart, i);
    }
    
    if (result[key] !== undefined) {
      issues.push({
        sourceType: 'M3U',
        lineNumber,
        message: `Duplicate attribute '${key}' used; the last value wins.`
      });
    }
    
    result[key] = attributeValue;
  }
  
  return result;
}

function firstNonEmpty(...values: string[]): string {
  for (const val of values) {
    if (val && val.trim()) {
      return val.trim();
    }
  }
  return '';
}
