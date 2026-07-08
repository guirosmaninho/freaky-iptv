import type { EpgGuide, EPGProgram, ParserIssue, Channel } from '../types';
import { downloadText } from './downloadText';
import { normalizeKey } from './utils';

export async function downloadAndParseEPG(
  epgUrl: string,
  progressCallback?: (status: string) => void
): Promise<EpgGuide> {
  if (progressCallback) progressCallback('Downloading TV guide...');
  
  const text = await downloadText(epgUrl, 'Failed to download EPG');
  if (progressCallback) progressCallback('Parsing TV guide...');
  return parseEPG(text);
}

export function parseEPG(xmlText: string): EpgGuide {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  
  const parserError = xmlDoc.querySelector('parsererror');
  const issues: ParserIssue[] = [];
  if (parserError) {
    issues.push({
      sourceType: 'XMLTV',
      lineNumber: 0,
      message: 'XML Parsing error: ' + parserError.textContent
    });
  }

  const displayNames: Record<string, string> = {};
  const normalizedNames: Record<string, string> = {};
  const programsByChannel: Record<string, EPGProgram[]> = {};

  // Parse Channels
  const channelNodes = xmlDoc.querySelectorAll('channel');
  channelNodes.forEach((node, index) => {
    const id = node.getAttribute('id')?.trim();
    if (!id) {
      issues.push({
        sourceType: 'XMLTV',
        lineNumber: index + 1,
        message: `Channel node at index ${index} has no id.`
      });
      return;
    }
    
    const displayNameNode = node.querySelector('display-name');
    const displayName = displayNameNode ? displayNameNode.textContent?.trim() : '';
    
    if (displayNames[id] !== undefined) {
      issues.push({
        sourceType: 'XMLTV',
        lineNumber: index + 1,
        message: `Duplicate XMLTV channel id '${id}' encountered; first display name is kept.`
      });
      return;
    }
    
    const finalDisplayName = displayName || id;
    displayNames[id] = finalDisplayName;
    
    const normalized = normalizeKey(finalDisplayName);
    if (normalized && normalizedNames[normalized] === undefined) {
      normalizedNames[normalized] = id;
    }
  });

  // Parse Programmes
  const programmeNodes = xmlDoc.querySelectorAll('programme');
  programmeNodes.forEach((node, index) => {
    const channelId = node.getAttribute('channel')?.trim() || '';
    const rawStart = node.getAttribute('start')?.trim() || '';
    const rawStop = node.getAttribute('stop')?.trim() || '';
    
    if (!channelId) {
      issues.push({
        sourceType: 'XMLTV',
        lineNumber: index + 1,
        message: `Programme at index ${index} has no channel id.`
      });
      return;
    }
    
    const start = parseXmlTvDate(rawStart);
    const stop = parseXmlTvDate(rawStop);
    
    if (!start || !stop || new Date(stop) <= new Date(start)) {
      issues.push({
        sourceType: 'XMLTV',
        lineNumber: index + 1,
        message: `Programme at index ${index} has invalid start/stop timestamps.`
      });
      return;
    }
    
    const titleNode = node.querySelector('title');
    const subTitleNode = node.querySelector('sub-title');
    const descNode = node.querySelector('desc');
    const categoryNode = node.querySelector('category');
    const iconNode = node.querySelector('icon');
    
    const program: EPGProgram = {
      channelId,
      title: titleNode?.textContent?.trim() || 'Untitled programme',
      subTitle: subTitleNode?.textContent?.trim() || '',
      description: descNode?.textContent?.trim() || '',
      category: categoryNode?.textContent?.trim() || '',
      iconUrl: iconNode?.getAttribute('src')?.trim() || '',
      startUtc: start,
      stopUtc: stop,
      rawStart,
      rawStop
    };
    
    if (!programsByChannel[channelId]) {
      programsByChannel[channelId] = [];
    }
    programsByChannel[channelId].push(program);
  });

  // Sort programs by start time lexicographically since startUtc is in ISO-8601 format
  for (const channelId in programsByChannel) {
    programsByChannel[channelId].sort((a, b) => {
      if (a.startUtc < b.startUtc) return -1;
      if (a.startUtc > b.startUtc) return 1;
      return 0;
    });
  }

  return {
    programsByChannel,
    displayNames,
    normalizedNames,
    issues
  };
}

export function parseXmlTvDate(value: string): string | null {
  if (!value) return null;
  
  // Format: yyyyMMddHHmmss [+-]HHmm or yyyyMMddHHmmss Z
  const match = value.trim().match(/^(\d{14})(?:\s*(Z|[+-]\d{2}:?\d{2}|[+-]\d{4}))?/i);
  if (!match) return null;
  
  const dateStr = match[1];
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6)) - 1; // 0-based month in JS
  const day = parseInt(dateStr.slice(6, 8));
  const hour = parseInt(dateStr.slice(8, 10));
  const min = parseInt(dateStr.slice(10, 12));
  const sec = parseInt(dateStr.slice(12, 14));
  
  const offsetStr = match[2];
  
  if (!offsetStr || offsetStr.toUpperCase() === 'Z') {
    if (!offsetStr) {
      // No offset, treat as local time
      const date = new Date(year, month, day, hour, min, sec);
      return date.toISOString();
    } else {
      // Z means UTC
      const date = new Date(Date.UTC(year, month, day, hour, min, sec));
      return date.toISOString();
    }
  }
  
  // Parse offset: +0100, -0500, +01:00
  const cleanOffset = offsetStr.replace(':', '');
  const sign = cleanOffset[0] === '-' ? -1 : 1;
  const offsetHours = parseInt(cleanOffset.slice(1, 3));
  const offsetMins = parseInt(cleanOffset.slice(3, 5)) || 0;
  
  const utcTime = Date.UTC(year, month, day, hour, min, sec);
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
