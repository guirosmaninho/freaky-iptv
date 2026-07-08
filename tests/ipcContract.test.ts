import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

const collectChannels = (source: string, pattern: RegExp) => {
  const channels = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    channels.add(match[1]);
  }
  return channels;
};

describe('Electron IPC contract', () => {
  it('registers every channel invoked by the preload bridge', () => {
    const preloadSource = readProjectFile('preload.cjs');
    const mainSource = readProjectFile('main.cjs');
    const invokedChannels = collectChannels(preloadSource, /ipcRenderer\.invoke\(['"]([^'"]+)['"]/g);
    const handledChannels = new Set([
      ...collectChannels(mainSource, /ipcMain\.handle\(['"]([^'"]+)['"]/g),
      ...collectChannels(mainSource, /registerTrustedHandle\(['"]([^'"]+)['"]/g),
    ]);

    const missingChannels = [...invokedChannels].filter(channel => !handledChannels.has(channel));

    assert.deepEqual(missingChannels, [], `Missing ipcMain.handle registrations: ${missingChannels.join(', ')}`);
  });

  it('registers every channel sent by the preload bridge', () => {
    const preloadSource = readProjectFile('preload.cjs');
    const mainSource = readProjectFile('main.cjs');
    const sentChannels = collectChannels(preloadSource, /ipcRenderer\.send\(['"]([^'"]+)['"]/g);
    const listenedChannels = new Set([
      ...collectChannels(mainSource, /ipcMain\.on\(['"]([^'"]+)['"]/g),
      ...collectChannels(mainSource, /registerTrustedOn\(['"]([^'"]+)['"]/g),
    ]);

    const missingChannels = [...sentChannels].filter(channel => !listenedChannels.has(channel));

    assert.deepEqual(missingChannels, [], `Missing ipcMain.on registrations: ${missingChannels.join(', ')}`);
  });

  it('registers each IPC channel exactly once', () => {
    const mainSource = readProjectFile('main.cjs');
    const registrations = [
      ...mainSource.matchAll(/(?:ipcMain\.(?:handle|on)|registerTrusted(?:Handle|On))\(['"]([^'"]+)['"]/g),
    ].map(match => match[1]);
    const duplicates = registrations.filter((channel, index) => registrations.indexOf(channel) !== index);

    assert.deepEqual([...new Set(duplicates)], [], `Duplicate IPC registrations: ${duplicates.join(', ')}`);
  });
});
