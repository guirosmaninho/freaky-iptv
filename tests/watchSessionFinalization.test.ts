import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import type { WatchSession } from '../src/types';

it('captures the outgoing session before a channel switch replaces the active session', async () => {
  const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const callback = source.match(/const endCurrentSession = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[historyRetentionDays\]\);/)?.[0];
  assert.ok(callback);
  const session = (id: string): WatchSession => ({ sessionId: id, channelId: id, channelName: id, channelGroup: '', startTimeUtc: new Date(Date.now() - 10000).toISOString(), playbackStartedAtUtc: new Date(Date.now() - 10000).toISOString(), endTimeUtc: '', bytesConsumed: 1024 });
  const outgoing = session('outgoing');
  const incoming = session('incoming');
  const activeSessionRef = { current: outgoing as WatchSession | null };
  const watchHistoryRef = { current: [] as WatchSession[] };
  const saved: WatchSession[] = [];
  let releaseSave!: () => void;
  const blockedSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const finish = new Function('useCallback', 'sessionFinalizeQueueRef', 'activeSessionRef', 'lastBufferingStartedAtMsRef', 'watchHistoryRef', 'historyRetentionDays', 'pruneWatchHistory', 'startTransition', 'setWatchHistory', 'window', 'ensureIpcSuccess', `${callback}; return endCurrentSession;`)(
    (fn: unknown) => fn, { current: Promise.resolve() }, activeSessionRef, { current: null }, watchHistoryRef, 365,
    (history: WatchSession[]) => history, (fn: () => void) => fn(), () => {},
    { electron: { appendHistory: async (value: WatchSession) => { saved.push(value); if (saved.length === 1) await blockedSave; return { ok: true }; } } }, () => {}
  ) as () => Promise<void>;

  const firstSave = finish();
  let flushFinished = false;
  const flush = finish().then(() => { flushFinished = true; });
  activeSessionRef.current = incoming;
  await Promise.resolve();
  assert.equal(flushFinished, false, 'closing without an active session still waits for queued writes');
  assert.deepEqual(saved.map(value => value.sessionId), ['outgoing']);
  releaseSave();
  await Promise.all([firstSave, flush]);
  assert.equal(activeSessionRef.current, incoming, 'finalizing the old session must not clear the new session');
  assert.deepEqual(saved.map(value => value.sessionId), ['outgoing']);
  assert.ok(saved[0].playingDurationMs! >= 10000);
  await finish();
  await finish();
  assert.deepEqual(saved.map(value => value.sessionId), ['outgoing', 'incoming'], 'each session is saved once in order');
});
