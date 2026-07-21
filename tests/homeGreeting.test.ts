import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GENERIC_HOME_GREETING_TEMPLATE_IDS,
  HOME_GREETING_TEMPLATE_IDS,
  getGreetingPeriod,
  loadGreetingHistory,
  rememberGreetingId,
  resolveHomeGreeting,
  selectHomeGreetingTemplate,
  type GreetingHistoryStorage,
  type HomeGreetingContext
} from '../src/services/homeGreeting';
import type { Channel, EPGProgram, WatchSession } from '../src/types';

const channel = (id: string, name: string): Channel => ({
  id,
  tvgId: id,
  name,
  logoUrl: '',
  groupTitle: 'General',
  streamUrl: `https://example.test/${id}`,
  duration: -1,
  attributes: {}
});

const programme = (channelId: string, title: string): EPGProgram => ({
  channelId,
  title,
  subTitle: '',
  description: '',
  category: '',
  iconUrl: '',
  startUtc: '2026-06-20T17:00:00.000Z',
  stopUtc: '2026-06-20T19:00:00.000Z',
  rawStart: '',
  rawStop: ''
});

const session = (
  channelId: string,
  channelName: string,
  playingDurationMs: number,
  startHour: number
): WatchSession => ({
  channelId,
  canonicalChannelId: channelId,
  channelName,
  baseChannelName: channelName,
  channelGroup: 'General',
  startTimeUtc: new Date(Date.UTC(2026, 5, 19, startHour)).toISOString(),
  endTimeUtc: new Date(Date.UTC(2026, 5, 19, startHour + 1)).toISOString(),
  playingDurationMs,
  bytesConsumed: 0
});

const makeContext = (overrides: Partial<HomeGreetingContext> = {}): HomeGreetingContext => ({
  now: new Date(2026, 5, 20, 18, 30),
  channels: [],
  recentChannelIds: [],
  favoriteChannelIds: new Set<string>(),
  watchHistory: [],
  getCurrentProgram: () => null,
  ...overrides
});

class MemoryStorage implements GreetingHistoryStorage {
  value: string | null = null;

  getItem(): string | null {
    return this.value;
  }

  setItem(_key: string, value: string): void {
    this.value = value;
  }
}

describe('home greeting periods', () => {
  it('uses the configured local-time boundaries', () => {
    const at = (hour: number, minute: number) => getGreetingPeriod(new Date(2026, 5, 20, hour, minute));

    assert.equal(at(0, 59), 'night');
    assert.equal(at(1, 0), 'late-night');
    assert.equal(at(4, 59), 'late-night');
    assert.equal(at(5, 0), 'morning');
    assert.equal(at(11, 59), 'morning');
    assert.equal(at(12, 0), 'afternoon');
    assert.equal(at(16, 59), 'afternoon');
    assert.equal(at(17, 0), 'evening');
    assert.equal(at(20, 59), 'evening');
    assert.equal(at(21, 0), 'night');
  });

  it('provides at least 80 curated templates and 25 always-available fallbacks', () => {
    assert.ok(HOME_GREETING_TEMPLATE_IDS.length >= 80);
    assert.ok(GENERIC_HOME_GREETING_TEMPLATE_IDS.length >= 25);
    assert.equal(new Set(HOME_GREETING_TEMPLATE_IDS).size, HOME_GREETING_TEMPLATE_IDS.length);
  });
});

describe('home greeting selection', () => {
  it('prefers the current programme on the channel watched for the longest time', () => {
    const rtp = channel('rtp', 'RTP 1');
    const sic = channel('sic', 'SIC');
    const programmes = new Map([
      ['rtp', programme('rtp', 'Telejornal')],
      ['sic', programme('sic', 'Jornal da Noite')]
    ]);
    const context = makeContext({
      channels: [rtp, sic],
      recentChannelIds: ['sic'],
      watchHistory: [
        session('rtp', 'RTP 1', 7_200_000, 10),
        session('sic', 'SIC', 1_800_000, 12),
        session('sic', 'SIC', 1_800_000, 13),
        session('sic', 'SIC', 1_800_000, 14)
      ],
      getCurrentProgram: item => programmes.get(item.id) || null
    });

    const selection = selectHomeGreetingTemplate(context, [], () => 0);
    const greeting = resolveHomeGreeting(selection, context);

    assert.equal(selection.family, 'top-program');
    assert.equal(greeting.highlight, 'RTP 1');
    assert.equal(greeting.programTitle, 'Telejornal');
    assert.match(`${greeting.headline} ${greeting.detail}`, /Telejornal/);
    assert.deepEqual(greeting.action, { kind: 'play-channel', label: 'Watch RTP 1', channelId: 'rtp' });
  });

  it('falls back to the playable channel id when the canonical history id is aggregated', () => {
    const rtp = channel('rtp', 'RTP 1');
    const watched = session('rtp', 'RTP 1', 7_200_000, 10);
    watched.canonicalChannelId = 'aggregated-name-hash';
    const context = makeContext({
      channels: [rtp],
      watchHistory: [watched],
      getCurrentProgram: () => programme('rtp', 'Telejornal')
    });

    const selection = selectHomeGreetingTemplate(context, [], () => 0);
    const greeting = resolveHomeGreeting(selection, context);

    assert.equal(selection.family, 'top-program');
    assert.equal(greeting.action.kind, 'play-channel');
  });

  it('removes country and transmission-quality labels from the displayed channel name', () => {
    const sportTv = channel('sport-tv-5', 'PT: Sport TV 5 Full HD');
    const context = makeContext({
      channels: [sportTv],
      recentChannelIds: ['sport-tv-5']
    });

    const selection = selectHomeGreetingTemplate(context, [], () => 0);
    const greeting = resolveHomeGreeting(selection, context);

    assert.equal(greeting.highlight, 'Sport TV 5');
    assert.doesNotMatch(`${greeting.headline} ${greeting.detail}`, /PT:|Full HD/i);
    assert.deepEqual(greeting.action, {
      kind: 'play-channel',
      label: 'Watch Sport TV 5',
      channelId: 'sport-tv-5'
    });
  });

  it('uses a live programme only when its channel is recent or favourite', () => {
    const randomChannel = channel('random', 'Random TV');
    const favourite = channel('favourite', 'Familiar TV');
    const context = makeContext({
      channels: [randomChannel, favourite],
      favoriteChannelIds: new Set(['favourite']),
      getCurrentProgram: item => programme(item.id, item.id === 'random' ? 'Random Show' : 'Familiar Show')
    });

    const selection = selectHomeGreetingTemplate(context, [], () => 0);
    const greeting = resolveHomeGreeting(selection, context);

    assert.equal(selection.family, 'program');
    assert.match(`${greeting.headline} ${greeting.detail}`, /Familiar Show/);
    assert.doesNotMatch(`${greeting.headline} ${greeting.detail}`, /Random Show/);
  });

  it('relaxes from a recently used top-program template to another relevant programme template', () => {
    const rtp = channel('rtp', 'RTP 1');
    const sic = channel('sic', 'SIC');
    const context = makeContext({
      channels: [rtp, sic],
      recentChannelIds: ['sic'],
      watchHistory: [session('rtp', 'RTP 1', 7_200_000, 10)],
      getCurrentProgram: item => programme(item.id, item.id === 'rtp' ? 'Telejornal' : 'Jornal da Noite')
    });
    const usedTopProgrammeTemplates = HOME_GREETING_TEMPLATE_IDS.filter(id => id.startsWith('top-program-'));

    const selection = selectHomeGreetingTemplate(context, usedTopProgrammeTemplates, () => 0);

    assert.equal(selection.family, 'program');
  });

  it('excludes recent template ids and falls back to the least recently used eligible id', () => {
    const context = makeContext();
    const firstTwenty = GENERIC_HOME_GREETING_TEMPLATE_IDS.slice(0, 20);
    const unused = selectHomeGreetingTemplate(context, firstTwenty, () => 0);
    const allUsed = selectHomeGreetingTemplate(context, GENERIC_HOME_GREETING_TEMPLATE_IDS, () => 0);

    assert.equal(unused.id, GENERIC_HOME_GREETING_TEMPLATE_IDS[20]);
    assert.equal(allUsed.id, GENERIC_HOME_GREETING_TEMPLATE_IDS.at(-1));
  });

  it('keeps the selected template while refreshing an expired programme', () => {
    const rtp = channel('rtp', 'RTP 1');
    let current = programme('rtp', 'Telejornal');
    const context = makeContext({
      channels: [rtp],
      recentChannelIds: ['rtp'],
      watchHistory: [session('rtp', 'RTP 1', 3_600_000, 10)],
      getCurrentProgram: () => current
    });
    const selection = selectHomeGreetingTemplate(context, [], () => 0);
    const before = resolveHomeGreeting(selection, context);

    current = programme('rtp', 'Linha da Frente');
    const after = resolveHomeGreeting(selection, context);

    assert.equal(before.id, after.id);
    assert.match(`${before.headline} ${before.detail}`, /Telejornal/);
    assert.match(`${after.headline} ${after.detail}`, /Linha da Frente/);
  });

  it('returns a navigable generic greeting when no viewing data is available', () => {
    const context = makeContext();
    const selection = selectHomeGreetingTemplate(context, [], () => 0);
    const greeting = resolveHomeGreeting(selection, context);

    assert.equal(selection.family, 'generic');
    assert.ok(greeting.headline.length > 0);
    assert.equal(greeting.action.kind, 'navigate');
  });

  it('indexes channel ids instead of rescanning the lineup for every history entry', () => {
    const channels = Array.from({ length: 1024 }, (_, index) => channel(`channel-${index}`, `Channel ${index}`));
    let indexedReads = 0;
    const observedChannels = new Proxy(channels, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      }
    });
    const watchHistory = Array.from({ length: 512 }, (_, index) => {
      const watched = session('channel-1023', 'Channel 1023', 60_000, index % 20);
      watched.canonicalChannelId = `canonical-${index}`;
      return watched;
    });
    const context = makeContext({ channels: observedChannels, watchHistory });

    const selection = selectHomeGreetingTemplate(context, [], () => 0);

    assert.equal(selection.family, 'top-channel');
    assert.ok(indexedReads < 20_000, `Expected indexed channel lookup, read ${indexedReads} channel entries.`);
  });
});

describe('home greeting history', () => {
  it('ignores malformed storage and keeps only the latest 20 valid ids', () => {
    const storage = new MemoryStorage();
    storage.value = '{not-json';
    assert.deepEqual(loadGreetingHistory(storage), []);

    for (const id of HOME_GREETING_TEMPLATE_IDS.slice(0, 25)) {
      rememberGreetingId(storage, id);
    }

    const history = loadGreetingHistory(storage);
    assert.equal(history.length, 20);
    assert.equal(history[0], HOME_GREETING_TEMPLATE_IDS[24]);
    assert.equal(history.at(-1), HOME_GREETING_TEMPLATE_IDS[5]);
  });
});
