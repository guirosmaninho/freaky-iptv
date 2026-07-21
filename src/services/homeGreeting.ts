import type { Channel, EPGProgram, WatchSession } from '../types';
import { getChannelBaseNamePreserveCase } from './utils';

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night' | 'late-night';
export type HomeGreetingFamily = 'top-program' | 'program' | 'top-channel' | 'recent' | 'favorite' | 'generic';

export type HomeGreetingAction =
  | { kind: 'play-channel'; label: string; channelId: string }
  | { kind: 'navigate'; label: string; section: 'Live' | 'Guide' };

export interface HomeGreeting {
  id: string;
  period: GreetingPeriod;
  eyebrow: string;
  headline: string;
  detail: string;
  highlight?: string;
  programTitle?: string;
  action: HomeGreetingAction;
}

export interface HomeGreetingSelection {
  id: string;
  period: GreetingPeriod;
  family: HomeGreetingFamily;
}

export interface HomeGreetingContext {
  now: Date;
  channels: Channel[];
  recentChannelIds: string[];
  favoriteChannelIds: ReadonlySet<string>;
  watchHistory: WatchSession[];
  qualityMappings?: Record<string, string>;
  getCurrentProgram: (channel: Channel) => EPGProgram | null;
}

export interface GreetingHistoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

type CopyTemplate = {
  id: string;
  family: HomeGreetingFamily;
  headline: string;
  detail: string;
};

type GreetingSubject = {
  channel: Channel;
  program: EPGProgram | null;
};

const GREETING_HISTORY_KEY = 'freaky-home-greeting-history:v1';
const GREETING_HISTORY_LIMIT = 20;

const genericCopy: Array<[string, string]> = [
  ['The screen is yours.', 'Live television is ready whenever you are.'],
  ['Take your pick.', 'There is always something worth finding in the guide.'],
  ['What are we watching?', 'Your channels are lined up and ready.'],
  ['Settle in.', 'A familiar channel is only a click away.'],
  ['Your {time} lineup is ready.', 'Browse live television or see what is coming next.'],
  ['Make this {time} yours.', 'Choose a channel and let the schedule take it from here.'],
  ['Something good might be on.', 'Open the guide and see what catches your eye.'],
  ['Ready when you are.', 'Pick up the remote, without needing the remote.'],
  ['A fresh look at live TV.', 'Your full channel list is waiting.'],
  ['Find your next watch.', 'Start live or take a quick look through the guide.'],
  ['The schedule is open.', 'See what is live across your channels.'],
  ['Your channels, your call.', 'Go straight to live television or browse first.'],
  ['There is room for one more programme.', 'See what is broadcasting right now.'],
  ['A quiet moment for live TV.', 'Your guide has the rest of the plan.'],
  ['See what is on.', 'The live schedule is ready to explore.'],
  ['Start wherever you like.', 'Every channel is within reach.'],
  ['Let the guide decide.', 'Browse what is live and what starts next.'],
  ['A good {time} starts here.', 'Find a programme that fits the moment.'],
  ['Live TV, on your terms.', 'Jump in now or scan the schedule first.'],
  ['The next channel is up to you.', 'Your library is ready to browse.'],
  ['There is more to watch.', 'Open live television and find something familiar.'],
  ['The guide knows what is next.', 'Take a look before you tune in.'],
  ['Choose the mood. We will find the channel.', 'Everything currently live is one step away.'],
  ['Your {time} watch starts here.', 'Browse the schedule or go directly to live TV.'],
  ['See where the schedule takes you.', 'A full lineup is waiting behind the guide.']
];

const topProgramCopy: Array<[string, string]> = [
  ['{program} is live on {channel}.', 'Your most-watched channel has something on right now.'],
  ['{channel} has your attention again.', '{program} is live now.'],
  ['Back to {channel}?', '{program} is already under way.'],
  ['Your usual channel is on.', 'Watch {program} live on {channel}.'],
  ['{program} has started.', 'It is live now on your most-watched channel, {channel}.'],
  ['{channel} saved you a spot.', '{program} is broadcasting now.'],
  ['A familiar signal from {channel}.', '{program} is live and ready to watch.'],
  ['Your top channel is ready.', '{program} is now showing on {channel}.'],
  ['{channel} is leading the lineup.', '{program} is live right now.'],
  ['Right on cue, {channel}.', '{program} is currently on air.'],
  ['{program} might be the move.', 'Your most-watched channel, {channel}, is showing it now.'],
  ['The familiar choice is live.', '{program} is on now at {channel}.'],
  ['{channel} is back in the frame.', '{program} is currently broadcasting.'],
  ['Your viewing history has a suggestion.', '{program} is live on {channel}.'],
  ['The channel you know best is live.', 'Tune in to {program} on {channel}.']
];

const programCopy: Array<[string, string]> = [
  ['{program} is live now.', 'Watch it on {channel}.'],
  ['Something familiar is on.', '{program} is showing on {channel}.'],
  ['{channel} has something for you.', '{program} is already under way.'],
  ['Caught this one in time.', '{program} is live on {channel}.'],
  ['Your channels have a live pick.', '{program} is showing now on {channel}.'],
  ['There is a familiar programme on.', 'Tune in to {program} on {channel}.'],
  ['{program} just made the shortlist.', 'It is live now on {channel}.'],
  ['A channel you know is live.', '{channel} is currently showing {program}.'],
  ['This might fit the moment.', '{program} is on now at {channel}.'],
  ['The guide found something relevant.', '{program} is broadcasting on {channel}.'],
  ['One of your channels is ready.', 'Watch {program} live on {channel}.'],
  ['{channel} is worth a look.', '{program} is currently on air.'],
  ['Your live lineup has a highlight.', '{program} is showing on {channel}.'],
  ['A recent favourite is broadcasting.', '{program} is live now on {channel}.'],
  ['The timing works.', '{program} is on {channel} right now.']
];

const topChannelCopy: Array<[string, string]> = [
  ['{channel} still leads your lineup.', 'Your most-watched channel is ready when you are.'],
  ['A familiar place to start: {channel}.', 'It has earned the top spot in your viewing history.'],
  ['{channel} knows the routine.', 'Go straight back to your most-watched channel.'],
  ['Your top channel is one click away.', 'Return to {channel} whenever you are ready.'],
  ['{channel} has been your main channel.', 'Pick up where your viewing habits point.'],
  ['The numbers point to {channel}.', 'It is the channel you have watched for the longest.'],
  ['Back to the top of your list?', '{channel} is ready to play.'],
  ['{channel} has become a regular.', 'Tune back in or explore the rest of the schedule.'],
  ['Your viewing history chose {channel}.', 'Start there or take a different route tonight.'],
  ['The familiar choice is {channel}.', 'Your most-watched channel is ready.']
];

const recentCopy: Array<[string, string]> = [
  ['Continue with {channel}.', 'It is one of the channels you watched most recently.'],
  ['Back to {channel}?', 'Your recent channel is ready to resume.'],
  ['Pick up with something familiar.', '{channel} is still close at hand.'],
  ['Your recent list starts with {channel}.', 'Go straight back or browse the full lineup.'],
  ['{channel} is still fresh.', 'Return to your recent channel in one click.'],
  ['A quick route back to {channel}.', 'Your latest channel is ready.'],
  ['Recently watched, ready again.', 'Tune back in to {channel}.'],
  ['Start where you left off.', '{channel} is waiting in your recent channels.']
];

const favoriteCopy: Array<[string, string]> = [
  ['One of your favourites is ready.', 'Tune in to {channel}.'],
  ['{channel} kept its place.', 'Your favourite channel is one click away.'],
  ['A starred channel for this {time}.', 'Go straight to {channel}.'],
  ['Your favourites make this easy.', 'Start with {channel}.'],
  ['{channel} is still on your shortlist.', 'Watch your favourite channel now.'],
  ['A reliable choice: {channel}.', 'Your starred channel is ready to play.'],
  ['Keep it familiar.', '{channel} is waiting in your favourites.'],
  ['Your shortlist points to {channel}.', 'Tune in whenever you are ready.']
];

const makeTemplates = (family: HomeGreetingFamily, copy: Array<[string, string]>): CopyTemplate[] =>
  copy.map(([headline, detail], index) => ({
    id: `${family}-${String(index + 1).padStart(2, '0')}`,
    family,
    headline,
    detail
  }));

const templatesByFamily: Record<HomeGreetingFamily, CopyTemplate[]> = {
  'top-program': makeTemplates('top-program', topProgramCopy),
  program: makeTemplates('program', programCopy),
  'top-channel': makeTemplates('top-channel', topChannelCopy),
  recent: makeTemplates('recent', recentCopy),
  favorite: makeTemplates('favorite', favoriteCopy),
  generic: makeTemplates('generic', genericCopy)
};

const allTemplates = Object.values(templatesByFamily).flat();
const templateById = new Map(allTemplates.map(template => [template.id, template]));

export const HOME_GREETING_TEMPLATE_IDS = Object.freeze(allTemplates.map(template => template.id));
export const GENERIC_HOME_GREETING_TEMPLATE_IDS = Object.freeze(templatesByFamily.generic.map(template => template.id));

const periodLabels: Record<GreetingPeriod, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Tonight',
  'late-night': 'After hours'
};

const periodNouns: Record<GreetingPeriod, string> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
  'late-night': 'late-night'
};

export const getGreetingPeriod = (date: Date): GreetingPeriod => {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  if (hour >= 21 || hour < 1) return 'night';
  return 'late-night';
};

const channelIds = (channel: Channel) => [channel.id, ...(channel.variants || []).map(variant => variant.id)];

const channelIndexCache = new WeakMap<Channel[], { length: number; index: Map<string, Channel> }>();

const getChannelIndex = (channels: Channel[]) => {
  const cached = channelIndexCache.get(channels);
  if (cached?.length === channels.length) return cached.index;

  const index = new Map<string, Channel>();
  for (const channel of channels) {
    for (const id of channelIds(channel)) index.set(id, channel);
  }
  channelIndexCache.set(channels, { length: channels.length, index });
  return index;
};

const findChannel = (channels: Channel[], id: string) =>
  getChannelIndex(channels).get(id);

const orderedRecentChannels = (context: HomeGreetingContext) => {
  const result: Channel[] = [];
  const seen = new Set<string>();
  for (const id of context.recentChannelIds) {
    const candidate = findChannel(context.channels, id);
    if (candidate && !seen.has(candidate.id)) {
      seen.add(candidate.id);
      result.push(candidate);
    }
  }
  return result;
};

const favoriteChannels = (context: HomeGreetingContext) =>
  context.channels.filter(channel => channelIds(channel).some(id => context.favoriteChannelIds.has(id)));

const sessionDurationMs = (session: WatchSession) => {
  const explicit = Number(session.playingDurationMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const start = Date.parse(session.playbackStartedAtUtc || session.startTimeUtc);
  const end = Date.parse(session.endTimeUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
};

const topChannel = (context: HomeGreetingContext): Channel | null => {
  const totals = new Map<string, number>();
  for (const session of context.watchHistory) {
    const channel = (session.canonicalChannelId && findChannel(context.channels, session.canonicalChannelId)) ||
      findChannel(context.channels, session.channelId);
    if (!channel) continue;
    totals.set(channel.id, (totals.get(channel.id) || 0) + sessionDurationMs(session));
  }

  let winner: Channel | null = null;
  let winnerMs = 0;
  for (const channel of context.channels) {
    const total = totals.get(channel.id) || 0;
    if (total > winnerMs) {
      winner = channel;
      winnerMs = total;
    }
  }
  return winner;
};

const currentSubject = (channel: Channel | null, context: HomeGreetingContext): GreetingSubject | null => {
  if (!channel) return null;
  return { channel, program: context.getCurrentProgram(channel) };
};

const relevantProgramSubject = (context: HomeGreetingContext): GreetingSubject | null => {
  const top = topChannel(context);
  const relevant = [top, ...orderedRecentChannels(context), ...favoriteChannels(context)];
  const seen = new Set<string>();

  for (const channel of relevant) {
    if (!channel || seen.has(channel.id)) continue;
    seen.add(channel.id);
    const program = context.getCurrentProgram(channel);
    if (program) return { channel, program };
  }
  return null;
};

const resolveSubject = (family: HomeGreetingFamily, context: HomeGreetingContext): GreetingSubject | null => {
  if (family === 'top-program') {
    const subject = currentSubject(topChannel(context), context);
    return subject?.program ? subject : relevantProgramSubject(context);
  }
  if (family === 'program') return relevantProgramSubject(context);
  if (family === 'top-channel') return currentSubject(topChannel(context), context);
  if (family === 'recent') return currentSubject(orderedRecentChannels(context)[0] || null, context);
  if (family === 'favorite') return currentSubject(favoriteChannels(context)[0] || null, context);
  return null;
};

const eligibleFamilies = (context: HomeGreetingContext): HomeGreetingFamily[] => {
  const families: HomeGreetingFamily[] = [];
  const top = topChannel(context);
  if (top && context.getCurrentProgram(top)) families.push('top-program');
  if (relevantProgramSubject(context)) families.push('program');
  if (top) families.push('top-channel');
  if (orderedRecentChannels(context).length > 0) families.push('recent');
  if (favoriteChannels(context).length > 0) families.push('favorite');
  families.push('generic');
  return families;
};

const pickIndex = (length: number, random: () => number) => {
  const value = random();
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(length - 1, Math.floor(value * length));
};

export const selectHomeGreetingTemplate = (
  context: HomeGreetingContext,
  recentIds: readonly string[],
  random: () => number = Math.random
): HomeGreetingSelection => {
  const recent = new Set(recentIds);
  const families = eligibleFamilies(context);

  for (const family of families) {
    const available = templatesByFamily[family].filter(template => !recent.has(template.id));
    if (available.length > 0) {
      const selected = available[pickIndex(available.length, random)];
      return { id: selected.id, period: getGreetingPeriod(context.now), family: selected.family };
    }
  }

  const eligible = families.flatMap(family => templatesByFamily[family]);
  const leastRecent = eligible.reduce((oldest, candidate) => {
    const oldestIndex = recentIds.lastIndexOf(oldest.id);
    const candidateIndex = recentIds.lastIndexOf(candidate.id);
    return candidateIndex > oldestIndex ? candidate : oldest;
  });
  return { id: leastRecent.id, period: getGreetingPeriod(context.now), family: leastRecent.family };
};

const displayChannelName = (subject: GreetingSubject | null, context: HomeGreetingContext) => {
  if (!subject) return 'Live TV';
  return getChannelBaseNamePreserveCase(subject.channel.name, context.qualityMappings) || subject.channel.name;
};

const interpolate = (
  value: string,
  period: GreetingPeriod,
  subject: GreetingSubject | null,
  context: HomeGreetingContext
) =>
  value
    .replaceAll('{time}', periodNouns[period])
    .replaceAll('{channel}', displayChannelName(subject, context))
    .replaceAll('{program}', subject?.program?.title || 'Live television');

const fallbackTemplate = (selection: HomeGreetingSelection) => {
  let hash = 0;
  for (const character of selection.id) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return templatesByFamily.generic[hash % templatesByFamily.generic.length];
};

export const resolveHomeGreeting = (
  selection: HomeGreetingSelection,
  context: HomeGreetingContext
): HomeGreeting => {
  const selectedTemplate = templateById.get(selection.id) || templatesByFamily.generic[0];
  const subject = resolveSubject(selection.family, context);
  const needsSubject = selection.family !== 'generic';
  const template = needsSubject && !subject ? fallbackTemplate(selection) : selectedTemplate;
  const hasPlayableSubject = Boolean(subject && findChannel(context.channels, subject.channel.id));
  const channelName = subject ? displayChannelName(subject, context) : undefined;

  return {
    id: selection.id,
    period: selection.period,
    eyebrow: periodLabels[selection.period],
    headline: interpolate(template.headline, selection.period, subject, context),
    detail: interpolate(template.detail, selection.period, subject, context),
    highlight: channelName,
    programTitle: subject?.program?.title,
    action: hasPlayableSubject && subject
      ? { kind: 'play-channel', label: `Watch ${channelName}`, channelId: subject.channel.id }
      : template.id.endsWith('02') || template.id.endsWith('11') || template.id.endsWith('17') || template.id.endsWith('22')
        ? { kind: 'navigate', label: 'Open TV guide', section: 'Guide' }
        : { kind: 'navigate', label: 'Browse live TV', section: 'Live' }
  };
};

export const loadGreetingHistory = (storage: GreetingHistoryStorage | null | undefined): string[] => {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(GREETING_HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(HOME_GREETING_TEMPLATE_IDS);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string' || !validIds.has(value) || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
      if (result.length === GREETING_HISTORY_LIMIT) break;
    }
    return result;
  } catch {
    return [];
  }
};

export const rememberGreetingId = (
  storage: GreetingHistoryStorage | null | undefined,
  id: string
): void => {
  if (!storage || !templateById.has(id)) return;
  try {
    const history = loadGreetingHistory(storage).filter(existing => existing !== id);
    storage.setItem(GREETING_HISTORY_KEY, JSON.stringify([id, ...history].slice(0, GREETING_HISTORY_LIMIT)));
  } catch {
    // Greeting history is an optional enhancement and must never block the Home screen.
  }
};
