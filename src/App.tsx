import React, { lazy, startTransition, Suspense, useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { HomeTab } from './components/HomeTab';
import { LiveGrid } from './components/LiveGrid';
import { TvGuideTab } from './components/TvGuideTab';
import { SettingsTab, type SettingsSavePayload } from './components/SettingsTab';
import { AboutTab } from './components/AboutTab';
import { RecordingsTab } from './components/RecordingsTab';
import type { AvailableReview, Channel, EPGProgram, EpgGuide, AppSettings, WatchSession, CacheSnapshot, StorageInfo, PlaybackSessionEvent, UiTheme, AppLanguage, Reminder } from './types';
import { downloadAndParseM3U } from './services/m3uParser';
import { downloadAndParseEPG } from './services/epgParser';
import { computeStats } from './services/statsCalculator';
import type { ComputedStats } from './services/statsCalculator';
import { EMPTY_CHANNEL_EPG_INFO, getEpgInfoFromPrograms } from './services/epgSchedule';
import type { ChannelEpgInfo } from './services/epgSchedule';
import { sha256Short, getChannelBaseName, getChannelBaseNamePreserveCase, getChannelQualityLabel, getQualityScore, normalizeKey } from './services/utils';
import { DEFAULT_APP_BEHAVIOUR, DEFAULT_QUALITY_MAPPINGS, normalizeQualityMappings, validateSourceUrl } from './services/settingsValidation';
import { getRelativeChannelIndex, isEditableShortcutTarget, nextVolume } from './services/channelNavigation';
import { collapseExactUrlDuplicates } from './services/duplicateDetection';
import { appendOpenedReviewId, computeAvailableReviews, getDisplayReview, normalizeOpenedReviewIds } from './services/reviewCalculator';
import {
  loadGreetingHistory,
  rememberGreetingId,
  resolveHomeGreeting,
  selectHomeGreetingTemplate,
  type HomeGreetingAction,
  type HomeGreetingContext,
  type HomeGreetingSelection
} from './services/homeGreeting';

type RefreshSourcesInternal = (
  targetPlaylistUrl: string,
  targetEpgUrl: string,
  favorites: string[],
  navigateToLive?: boolean,
  targetQualityMappings?: Record<string, string>,
  options?: { persistSettings?: boolean }
) => Promise<void>;

const EMPTY_UPCOMING: EPGProgram[] = [];

const VideoPlayer = lazy(() => import('./components/VideoPlayer').then(module => ({
  default: module.VideoPlayer
})));
const StatsTab = lazy(() => import('./components/StatsTab').then(module => ({ default: module.StatsTab })));
const AnnualReview = lazy(() => import('./components/AnnualReview').then(module => ({ default: module.AnnualReview })));

const CACHE_SCHEMA_VERSION = 1;
const CACHE_PARSER_VERSION = 'react-ts-v1';
const VOLUME_PERSIST_DEBOUNCE_MS = 400;

async function finishActiveRecording() {
  const recording = await window.electron.getRecordingState();
  if (recording.status !== 'recording' && recording.status !== 'finalizing') return;
  // stopSourceRecording returns the in-flight finalization promise as well.
  await window.electron.stopSourceRecording();
}

const buildCategoryList = (channelList: Channel[]) => {
  const seen = new Set<string>();
  for (const ch of channelList) {
    if (ch.groupTitle) seen.add(ch.groupTitle);
  }

  const sorted = Array.from(seen).sort((a, b) => a.localeCompare(b));
  return ['All channels', ...sorted];
};

const getChannelVariantIds = (channel: Channel) => {
  const ids = new Set<string>();
  ids.add(channel.id);
  for (const variant of channel.variants || []) {
    ids.add(variant.id);
  }
  return Array.from(ids);
};

const isChannelFavorite = (channel: Channel, favoriteIds: Set<string>) => {
  return getChannelVariantIds(channel).some(id => favoriteIds.has(id));
};

const countEpgPrograms = (programsByChannel: Record<string, EPGProgram[]>) => {
  let count = 0;
  for (const list of Object.values(programsByChannel)) {
    count += list.length;
  }
  return count;
};

const resolveProgramsForChannel = (channel: Channel, guide: EpgGuide): EPGProgram[] => {
  const candidateIds = new Set<string>();
  if (channel.tvgId) candidateIds.add(channel.tvgId);
  for (const variant of channel.variants || []) {
    if (variant.tvgId) candidateIds.add(variant.tvgId);
  }

  for (const id of candidateIds) {
    const programs = guide.programsByChannel[id];
    if (programs) return programs;
  }

  const candidateNames = new Set<string>();
  if (channel.name) candidateNames.add(channel.name);
  for (const variant of channel.variants || []) {
    if (variant.name) candidateNames.add(variant.name);
  }

  for (const name of candidateNames) {
    const guideChannelId = guide.normalizedNames[normalizeKey(name)];
    if (!guideChannelId) continue;

    const programs = guide.programsByChannel[guideChannelId];
    if (programs) return programs;
  }

  return EMPTY_UPCOMING;
};

const buildChannelProgramLookup = (channelList: Channel[], guide: EpgGuide) => {
  const lookup = new Map<string, EPGProgram[]>();

  for (const channel of channelList) {
    const programs = resolveProgramsForChannel(channel, guide);
    lookup.set(channel.id, programs);

    for (const variant of channel.variants || []) {
      lookup.set(variant.id, programs);
    }
  }

  return lookup;
};

const buildPlayableChannelIndex = (channelList: Channel[]) => {
  const channelById = new Map<string, Channel>();
  const indexById = new Map<string, number>();

  channelList.forEach((channel, index) => {
    channelById.set(channel.id, channel);
    indexById.set(channel.id, index);

    for (const variant of channel.variants || []) {
      channelById.set(variant.id, channel);
      indexById.set(variant.id, index);
    }
  });

  return { channelById, indexById };
};

const attachPlaybackVariants = (channel: Channel, groupedChannels: Channel[]): Channel => {
  if (channel.variants && channel.variants.length > 1) {
    return channel;
  }

  const group = groupedChannels.find(grouped =>
    grouped.id === channel.id || grouped.variants?.some(variant => variant.id === channel.id)
  );

  if (!group?.variants || group.variants.length <= 1) {
    return channel;
  }

  const selectedVariant = group.variants.find(variant => variant.id === channel.id) || group;
  return {
    ...selectedVariant,
    variants: group.variants
  };
};

const groupChannelsByQuality = (rawChannels: Channel[], mappings?: Record<string, string>): Channel[] => {
  const groups: Record<string, Channel[]> = {};
  
  for (const ch of collapseExactUrlDuplicates(rawChannels)) {
    const baseName = getChannelBaseName(ch.name, mappings) || ch.name;
    const groupKey = `${ch.groupTitle || ''}\u0000${baseName}`;
    const channelWithoutVariants = { ...ch, variants: undefined };
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(channelWithoutVariants);
  }

  const result: Channel[] = [];

  for (const groupKey in groups) {
    const list = groups[groupKey];
    // Sort quality descending: 4K (100) > FHD (80) > HD (60) > SD (40) > Backup (20)
    list.sort((a, b) => {
      const scoreA = getQualityScore(getChannelQualityLabel(a.name, mappings));
      const scoreB = getQualityScore(getChannelQualityLabel(b.name, mappings));
      return scoreB - scoreA;
    });

    const variants = list.map(ch => ({ ...ch }));
    const contentRevision = sha256Short(
      variants.map(variant => [
        variant.id,
        variant.name,
        variant.streamUrl,
        variant.logoUrl,
        variant.tvgId,
        variant.groupTitle
      ].join('\u0000')).join('\u0001')
    );
    for (const variant of variants) {
      variant.variants = variants;
      variant.contentRevision = contentRevision;
    }

    // The primary channel is the highest quality.
    result.push(variants[0]);
  }

  return result;
};


const getErrorMessage = (err: unknown, fallback: string) => {
  return err instanceof Error && err.message ? err.message : fallback;
};

const isUsableCacheSnapshot = (
  cache: CacheSnapshot,
  playlistUrl: string,
  epgUrl: string
) => {
  const playlistHash = sha256Short(playlistUrl.trim());
  const epgHash = epgUrl ? sha256Short(epgUrl.trim()) : '';

  return cache.schemaVersion === CACHE_SCHEMA_VERSION &&
    cache.parserVersion === CACHE_PARSER_VERSION &&
    cache.playlistUrlHash === playlistHash &&
    (!epgUrl || cache.epgUrlHash === epgHash);
};

const pruneWatchHistory = (history: WatchSession[], retentionDays: number) => {
  if (retentionDays <= 0) return history;

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return history.filter(session => {
    const endMs = new Date(session.endTimeUtc || session.startTimeUtc).getTime();
    return Number.isFinite(endMs) && endMs >= cutoffMs;
  });
};

const ensureIpcSuccess = (result: boolean, message: string) => {
  if (!result) throw new Error(message);
};

export const App: React.FC = () => {
  // Navigation & UI States
  const [activeSection, setActiveSection] = useState('Home');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1200);
  const [isLoading, setIsLoading] = useState(true);
  
  // App settings & sources
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [epgUrl, setEpgUrl] = useState('');
  const [volume, setVolume] = useState(80);
  const [favoriteChannelIds, setFavoriteChannelIds] = useState<Set<string>>(new Set());
  const [recentChannelIds, setRecentChannelIds] = useState<string[]>([]);
  const [rawChannels, setRawChannels] = useState<Channel[]>([]);
  const [qualityMappings, setQualityMappings] = useState<Record<string, string>>(DEFAULT_QUALITY_MAPPINGS);
  const [autoRefreshHours, setAutoRefreshHours] = useState(DEFAULT_APP_BEHAVIOUR.autoRefreshHours);
  const [autoplayLastChannel, setAutoplayLastChannel] = useState(DEFAULT_APP_BEHAVIOUR.autoplayLastChannel);
  const [historyRetentionDays, setHistoryRetentionDays] = useState(DEFAULT_APP_BEHAVIOUR.historyRetentionDays);
  const [appearance, setAppearance] = useState<UiTheme>('system');
  const [language, setLanguage] = useState<AppLanguage>('system');
  const [recordingDirectory, setRecordingDirectory] = useState('');
  
  // Discord settings
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(true);
  const [discordShowChannel, setDiscordShowChannel] = useState(true);
  const [discordShowProgram, setDiscordShowProgram] = useState(false);
  const [discordShowArtwork, setDiscordShowArtwork] = useState(false);
  const [discordClientId, setDiscordClientId] = useState('1514411481259577364');
  
  // Channels and EPG guide data
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<string[]>(['All channels']);
  const [epgGuide, setEpgGuide] = useState<EpgGuide>({
    programsByChannel: {},
    displayNames: {},
    normalizedNames: {},
    issues: []
  });

  // Active video channel & controls
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [playerCollapseRequest, setPlayerCollapseRequest] = useState(0);
  const [currentPlayStartTime, setCurrentPlayStartTime] = useState<string>('');
  const [zapPreview, setZapPreview] = useState<Channel | null>(null);

  // Statistics and history
  const [watchHistory, setWatchHistory] = useState<WatchSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [stats, setStats] = useState<ComputedStats | null>(null);
  const [epgTickMs, setEpgTickMs] = useState(() => Date.now());
  const [reviewClockMs, setReviewClockMs] = useState(() => Date.now());
  const [openedReviewIds, setOpenedReviewIds] = useState<string[]>([]);
  const [dismissedReviewIds, setDismissedReviewIds] = useState<string[]>([]);
  const [homeGreetingSelection, setHomeGreetingSelection] = useState<HomeGreetingSelection | null>(null);

  // Status and logs
  const [cacheStatusText, setCacheStatusText] = useState('No cache loaded');
  const [guideStatusText, setGuideStatusText] = useState('No guide loaded');
  const [statusText, setStatusText] = useState(() => {
    const importNotice = sessionStorage.getItem('freaky-import-notice');
    if (importNotice) sessionStorage.removeItem('freaky-import-notice');
    return importNotice || 'Ready';
  });
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);

  // Active watch session tracker ref
  const activeSessionRef = useRef<WatchSession | null>(null);
  const lastBufferingStartedAtMsRef = useRef<number | null>(null);
  const tickerRef = useRef<number | null>(null);
  const watchHistoryRef = useRef<WatchSession[]>([]);
  const openedReviewIdsRef = useRef<string[]>([]);
  const dismissedReviewIdsRef = useRef<string[]>([]);
  const refreshSourcesInternalRef = useRef<RefreshSourcesInternal | null>(null);
  const endCurrentSessionRef = useRef<() => Promise<void>>(async () => {});
  const playChannelRef = useRef<((channel: Channel, saveState?: boolean, preserveExpanded?: boolean) => Promise<void>) | null>(null);
  const settingsVersionRef = useRef(0);
  const volumeSaveTimerRef = useRef<number | null>(null);
  const pendingVolumeSaveRef = useRef<(() => Promise<void>) | null>(null);
  const activeChannelRef = useRef<Channel | null>(null);
  const zapPreviewTimerRef = useRef<number | null>(null);
  const sourceSyncSequenceRef = useRef(0);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  const refreshStorageInfo = useCallback(async () => {
    try {
      setStorageInfo(await window.electron.getStorageInfo());
    } catch (err) {
      console.warn('Failed to load storage info:', err);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyAppearance = () => {
      const resolved = appearance === 'system' ? (media.matches ? 'dark' : 'light') : appearance;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };

    applyAppearance();
    if (appearance !== 'system') return;
    media.addEventListener('change', applyAppearance);
    return () => media.removeEventListener('change', applyAppearance);
  }, [appearance]);

  const channelProgramLookup = useMemo(
    () => buildChannelProgramLookup(channels, epgGuide),
    [channels, epgGuide]
  );

  const playableChannelIndex = useMemo(
    () => buildPlayableChannelIndex(channels),
    [channels]
  );

  const favoritesCount = useMemo(
    () => channels.reduce((count, channel) => count + (isChannelFavorite(channel, favoriteChannelIds) ? 1 : 0), 0),
    [channels, favoriteChannelIds]
  );

  const recentChannels = useMemo(() => {
    const list: Channel[] = [];
    const seen = new Set<string>();

    for (const id of recentChannelIds) {
      const found = playableChannelIndex.channelById.get(id);
      if (found && !seen.has(found.id)) {
        seen.add(found.id);
        list.push(found);
      }
    }

    return list;
  }, [playableChannelIndex, recentChannelIds]);

  const getChannelEpgInfo = useCallback((channel: Channel): ChannelEpgInfo => {
    return getEpgInfoFromPrograms(channelProgramLookup.get(channel.id), epgTickMs);
  }, [channelProgramLookup, epgTickMs]);

  const activeChannelEpgInfo = useMemo(
    () => activeChannel ? getChannelEpgInfo(activeChannel) : EMPTY_CHANNEL_EPG_INFO,
    [activeChannel, getChannelEpgInfo]
  );

  const homeGreetingContext = useMemo<HomeGreetingContext>(() => ({
    now: new Date(epgTickMs),
    channels,
    recentChannelIds,
    favoriteChannelIds,
    watchHistory,
    qualityMappings,
    getCurrentProgram: channel => getChannelEpgInfo(channel).program
  }), [channels, epgTickMs, favoriteChannelIds, getChannelEpgInfo, qualityMappings, recentChannelIds, watchHistory]);

  const homeGreeting = useMemo(
    () => homeGreetingSelection ? resolveHomeGreeting(homeGreetingSelection, homeGreetingContext) : null,
    [homeGreetingContext, homeGreetingSelection]
  );

  useEffect(() => {
    if (!activeChannel || activeChannelEpgInfo.nextChangeAtMs === null) return;

    const delayMs = Math.max(0, activeChannelEpgInfo.nextChangeAtMs - Date.now()) + 50;
    const timeoutId = window.setTimeout(() => {
      setEpgTickMs(Date.now());
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [activeChannel, activeChannelEpgInfo.nextChangeAtMs]);

  useEffect(() => {
    if (import.meta.env.DEV) console.log('[Discord RPC Hook] Activity state changed');
    if (!discordRpcEnabled) {
      window.electron.clearDiscordActivity().catch(() => {});
      return;
    }

    if (!activeChannel || !currentPlayStartTime) {
      window.electron.clearDiscordActivity().catch(() => {});
      return;
    }

    const baseChannelName = getChannelBaseNamePreserveCase(activeChannel.name, qualityMappings) || activeChannel.name;
    const programTitle = activeChannelEpgInfo.program?.title || '';

    window.electron.setDiscordActivity(
      baseChannelName,
      currentPlayStartTime,
      activeChannel.logoUrl || '',
      programTitle
    ).catch(err => {
      console.warn('Failed to set Discord activity:', err);
    });
  }, [
    activeChannel,
    activeChannelEpgInfo.program?.title,
    currentPlayStartTime,
    qualityMappings,
    discordRpcEnabled,
    discordShowChannel
  ]);

  useEffect(() => {
    watchHistoryRef.current = watchHistory;
  }, [watchHistory]);

  const availableReviews = useMemo(
    () => computeAvailableReviews(watchHistory, new Date(reviewClockMs), qualityMappings),
    [qualityMappings, reviewClockMs, watchHistory]
  );
  const displayedReview = useMemo(
    () => getDisplayReview(availableReviews, dismissedReviewIds),
    [availableReviews, dismissedReviewIds]
  );
  const isDisplayedReviewOpened = Boolean(displayedReview && openedReviewIds.includes(displayedReview.period.key));
  const annualReview = useMemo(
    () => availableReviews.find(review => review.kind === 'annual' && review.annualData) || null,
    [availableReviews]
  );
  const effectiveActiveSection = activeSection === 'YearReview' && !annualReview ? 'Home' : activeSection;

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timeoutId = window.setTimeout(() => setReviewClockMs(Date.now()), Math.max(1000, nextMidnight.getTime() - now.getTime() + 100));
    return () => window.clearTimeout(timeoutId);
  }, [reviewClockMs]);

  // 1. Initial Startup Load
  useEffect(() => {
    const initializeApp = async () => {
      setIsLoading(true);
      setStatusText('Initializing app...');
      let greetingWasSelected = false;
      let loadedChannels: Channel[] = [];
      let loadedGuide: EpgGuide = {
        programsByChannel: {},
        displayNames: {},
        normalizedNames: {},
        issues: []
      };
      try {
        // A. Load Settings
        const settings: AppSettings = await window.electron.loadSettings();
        setPlaylistUrl(settings.playlistUrl || '');
        setEpgUrl(settings.epgUrl || '');
        setVolume(settings.volume !== undefined ? settings.volume : 80);
        setFavoriteChannelIds(new Set(settings.favoriteChannelIds || []));
        setRecentChannelIds(settings.recentlyViewedChannelIds || []);

        const mappings = normalizeQualityMappings(settings.qualityMappings || DEFAULT_QUALITY_MAPPINGS);
        setQualityMappings(mappings);
        const loadedAutoRefreshHours = settings.autoRefreshHours ?? DEFAULT_APP_BEHAVIOUR.autoRefreshHours;
        const loadedAutoplayLastChannel = settings.autoplayLastChannel ?? DEFAULT_APP_BEHAVIOUR.autoplayLastChannel;
        const loadedHistoryRetentionDays = settings.historyRetentionDays ?? DEFAULT_APP_BEHAVIOUR.historyRetentionDays;
        setAutoRefreshHours(loadedAutoRefreshHours);
        setAutoplayLastChannel(loadedAutoplayLastChannel);
        setHistoryRetentionDays(loadedHistoryRetentionDays);
        setAppearance(settings.appearance || 'system');
        setLanguage(settings.language || 'system');
        setRecordingDirectory(settings.recordingDirectory || '');
        const loadedOpenedReviewIds = normalizeOpenedReviewIds(settings.openedReviewIds);
        openedReviewIdsRef.current = loadedOpenedReviewIds;
        setOpenedReviewIds(loadedOpenedReviewIds);
        const loadedDismissedReviewIds = normalizeOpenedReviewIds(settings.dismissedReviewIds);
        dismissedReviewIdsRef.current = loadedDismissedReviewIds;
        setDismissedReviewIds(loadedDismissedReviewIds);
        setDiscordRpcEnabled(settings.discordRpcEnabled !== undefined ? settings.discordRpcEnabled : true);
        setDiscordShowChannel(settings.discordShowChannel !== undefined ? settings.discordShowChannel : true);
        setDiscordShowProgram(settings.discordShowProgram === true);
        setDiscordShowArtwork(settings.discordShowArtwork === true);
        setDiscordClientId(settings.discordClientId || '1514411481259577364');

        // B. Load Cache
        const cache: CacheSnapshot | null = await window.electron.loadCache();
        let cacheValid = false;
        let shouldRefresh = true;
        
        if (cache && settings.playlistUrl && isUsableCacheSnapshot(cache, settings.playlistUrl, settings.epgUrl || '')) {
            // Rebuild EpgGuide from cache programs list
            const programsByChannel: Record<string, EPGProgram[]> = {};
            for (const prog of cache.programs || []) {
              if (!programsByChannel[prog.channelId]) {
                programsByChannel[prog.channelId] = [];
              }
              programsByChannel[prog.channelId].push(prog);
            }
            
            const guide: EpgGuide = {
              programsByChannel,
              displayNames: cache.epgChannelDisplayNames || {},
              normalizedNames: cache.epgNormalizedNameMap || {},
              issues: []
            };

            const cachedRaw = cache.channels || [];
            setRawChannels(cachedRaw);

            const grouped = groupChannelsByQuality(cachedRaw, mappings);
            loadedChannels = grouped;
            loadedGuide = guide;
            setChannels(grouped);
            setEpgGuide(guide);
            setCategories(buildCategoryList(grouped));
            
            setCacheStatusText(`Loaded cache from ${new Date(cache.savedAtUtc).toLocaleString()}.`);
            setGuideStatusText(cache.programs?.length 
              ? `${cache.programs.length.toLocaleString()} cached programmes.` 
              : 'No cached guide programmes.'
            );
            cacheValid = true;
            
            const cacheAgeMs = Date.now() - new Date(cache.savedAtUtc).getTime();
            const refreshIntervalMs = loadedAutoRefreshHours * 60 * 60 * 1000;
            if (loadedAutoRefreshHours <= 0 || cacheAgeMs <= refreshIntervalMs) {
              shouldRefresh = false;
            }
        }
        
        if (!cacheValid) {
          setCacheStatusText('No valid cache matching current settings found.');
        }

        // C. Load History & Compute Stats
        const history: WatchSession[] = await window.electron.loadHistory();
        setReminders(await window.electron.loadReminders());
        const retainedHistory = pruneWatchHistory(history, loadedHistoryRetentionDays);
        if (retainedHistory.length !== history.length) {
          ensureIpcSuccess(await window.electron.saveHistory(retainedHistory), 'Failed to save pruned history.');
        }
        setWatchHistory(retainedHistory);
        setStats(computeStats(retainedHistory, { qualityMappings: mappings }));

        const greetingNow = new Date();
        const greetingContext: HomeGreetingContext = {
          now: greetingNow,
          channels: loadedChannels,
          recentChannelIds: settings.recentlyViewedChannelIds || [],
          favoriteChannelIds: new Set(settings.favoriteChannelIds || []),
          watchHistory: retainedHistory,
          qualityMappings: mappings,
          getCurrentProgram: channel => getEpgInfoFromPrograms(
            resolveProgramsForChannel(channel, loadedGuide),
            greetingNow.getTime()
          ).program
        };
        const greetingSelection = selectHomeGreetingTemplate(
          greetingContext,
          loadGreetingHistory(window.localStorage)
        );
        rememberGreetingId(window.localStorage, greetingSelection.id);
        setHomeGreetingSelection(greetingSelection);
        greetingWasSelected = true;

        setStatusText(cacheValid ? 'Ready (Loaded from cache)' : 'Ready');
        await refreshStorageInfo();

        // D. Trigger Background Refresh
        if (settings.playlistUrl && shouldRefresh) {
          const capturedSettingsVersion = settingsVersionRef.current;
          // Delay background sync to let the UI boot and render smoothly first
          window.setTimeout(() => {
            const refreshSourcesInternal = refreshSourcesInternalRef.current;
            if (!refreshSourcesInternal || settingsVersionRef.current !== capturedSettingsVersion) return;

            refreshSourcesInternal(settings.playlistUrl, settings.epgUrl, settings.favoriteChannelIds || [], false, mappings, { persistSettings: false })
              .catch((e) => console.warn('Background sync failed:', e));
          }, 4000);
        }

        // E. AutoPlay last watched channel
        if (loadedAutoplayLastChannel && settings.lastPlayedChannelId && cacheValid) {
          const found = (cache?.channels || []).find((c: Channel) => c.id === settings.lastPlayedChannelId);
          if (found) {
            setTimeout(() => {
              void playChannelRef.current?.(found, false);
            }, 600);
          }
        }
      } catch (err) {
        console.error('App initialization failed:', err);
        setStatusText('Initialization failed.');
        if (!greetingWasSelected) {
          const fallbackContext: HomeGreetingContext = {
            now: new Date(),
            channels: [],
            recentChannelIds: [],
            favoriteChannelIds: new Set<string>(),
            watchHistory: [],
            getCurrentProgram: () => null
          };
          const fallbackSelection = selectHomeGreetingTemplate(
            fallbackContext,
            loadGreetingHistory(window.localStorage)
          );
          rememberGreetingId(window.localStorage, fallbackSelection.id);
          setHomeGreetingSelection(fallbackSelection);
        }
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();

    // Setup periodic guide update ticker (every minute to refresh progress bars)
    tickerRef.current = window.setInterval(() => {
      setEpgTickMs(Date.now());
    }, 60 * 1000);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      void endCurrentSessionRef.current();
      window.electron.clearDiscordActivity().catch(() => {});
    };
  }, [refreshStorageInfo]);

  const handleNavigate = useCallback((section: string) => {
    if (activeSection === 'Settings' && section !== 'Settings' && settingsDirty) {
      if (!window.confirm('Discard unsaved settings changes?')) return;
      const resolved = appearance === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : appearance;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      setSettingsDirty(false);
    }
    setPlayerCollapseRequest(current => current + 1);
    startTransition(() => {
      setActiveSection(current => current === section ? current : section);
    });
  }, [activeSection, appearance, settingsDirty]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(current => !current);
  }, []);

  // Helper to save settings
  const saveSettingsInternal = useCallback(async (
    pUrl: string,
    eUrl: string,
    vol: number,
    favIds: string[],
    recentIds: string[],
    lastChannelId: string,
    mappingsObj: Record<string, string>,
    behaviour?: Partial<SettingsSavePayload>
  ) => {
    const settings: AppSettings = {
      playlistUrl: pUrl.trim(),
      epgUrl: eUrl.trim(),
      volume: vol,
      favoriteChannelIds: favIds,
      recentlyViewedChannelIds: recentIds,
      lastPlayedChannelId: lastChannelId,
      qualityMappings: normalizeQualityMappings(mappingsObj),
      autoRefreshHours: behaviour?.autoRefreshHours ?? autoRefreshHours,
      autoplayLastChannel: behaviour?.autoplayLastChannel ?? autoplayLastChannel,
      historyRetentionDays: behaviour?.historyRetentionDays ?? historyRetentionDays,
      discordRpcEnabled: behaviour?.discordRpcEnabled ?? discordRpcEnabled,
      discordShowChannel: behaviour?.discordShowChannel ?? discordShowChannel,
      discordShowProgram: behaviour?.discordShowProgram ?? discordShowProgram,
      discordShowArtwork: behaviour?.discordShowArtwork ?? discordShowArtwork,
      discordClientId: behaviour?.discordClientId ?? discordClientId,
      appearance: behaviour?.appearance ?? appearance,
      language: behaviour?.language ?? language,
      recordingDirectory: behaviour?.recordingDirectory ?? recordingDirectory,
      recordingMode: 'source-mkv',
      openedReviewIds: openedReviewIdsRef.current,
      dismissedReviewIds: dismissedReviewIdsRef.current
    };
    ensureIpcSuccess(await window.electron.saveSettings(settings), 'Failed to save settings.');
    settingsVersionRef.current += 1;
    await refreshStorageInfo();
  }, [appearance, autoRefreshHours, autoplayLastChannel, historyRetentionDays, discordRpcEnabled, discordShowArtwork, discordShowChannel, discordShowProgram, discordClientId, language, recordingDirectory, refreshStorageInfo]);

  const handleOpenReview = useCallback(async (review: AvailableReview) => {
    const nextOpenedReviewIds = appendOpenedReviewId(openedReviewIdsRef.current, review.period.key);
    openedReviewIdsRef.current = nextOpenedReviewIds;
    setOpenedReviewIds(nextOpenedReviewIds);
    handleNavigate(review.kind === 'annual' ? 'YearReview' : 'Stats');

    try {
      await saveSettingsInternal(
        playlistUrl,
        epgUrl,
        volume,
        Array.from(favoriteChannelIds),
        recentChannelIds,
        activeChannel?.id || '',
        qualityMappings
      );
    } catch (err) {
      console.error('Failed to persist opened review:', err);
      setStatusText('Review opened, but its read status could not be saved.');
    }
  }, [activeChannel, epgUrl, favoriteChannelIds, handleNavigate, playlistUrl, qualityMappings, recentChannelIds, saveSettingsInternal, volume]);

  const handleDismissReview = useCallback(async (review: AvailableReview) => {
    const nextDismissedReviewIds = appendOpenedReviewId(dismissedReviewIdsRef.current, review.period.key);
    dismissedReviewIdsRef.current = nextDismissedReviewIds;
    setDismissedReviewIds(nextDismissedReviewIds);

    try {
      await saveSettingsInternal(
        playlistUrl,
        epgUrl,
        volume,
        Array.from(favoriteChannelIds),
        recentChannelIds,
        activeChannel?.id || '',
        qualityMappings
      );
    } catch (err) {
      console.error('Failed to persist dismissed review:', err);
      setStatusText('Review dismissed, but this choice could not be saved.');
    }
  }, [activeChannel, epgUrl, favoriteChannelIds, playlistUrl, qualityMappings, recentChannelIds, saveSettingsInternal, volume]);

  const flushPendingVolumeSave = useCallback(async () => {
    if (volumeSaveTimerRef.current !== null) {
      window.clearTimeout(volumeSaveTimerRef.current);
      volumeSaveTimerRef.current = null;
    }

    const save = pendingVolumeSaveRef.current;
    pendingVolumeSaveRef.current = null;
    if (save) await save();
  }, []);

  // Manual refresh logic
  const handleRefresh = async (payload?: SettingsSavePayload) => {
    setIsLoading(true);
    setStatusText('Reloading files...');
    try {
      const targetPlaylistUrl = payload?.playlistUrl ?? playlistUrl;
      const targetEpgUrl = payload?.epgUrl ?? epgUrl;
      const targetMappings = payload?.qualityMappings ?? qualityMappings;
      await refreshSourcesInternal(
        targetPlaylistUrl,
        targetEpgUrl,
        Array.from(favoriteChannelIds),
        true,
        targetMappings,
        { persistSettings: !payload }
      );
    } catch (err: unknown) {
      console.error('Refresh failed:', err);
      setStatusText(getErrorMessage(err, 'Refresh failed. Check your network connection.'));
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Core M3U and EPG downloader and parser worker
  const refreshSourcesInternal = useCallback(async (
    targetPlaylistUrl: string,
    targetEpgUrl: string,
    favorites: string[],
    navigateToLive = false,
    targetQualityMappings?: Record<string, string>,
    options: { persistSettings?: boolean } = {}
  ) => {
    const operationId = ++sourceSyncSequenceRef.current;
    const isCurrentOperation = () => sourceSyncSequenceRef.current === operationId;
    const reportStatus = (message: string) => {
      if (isCurrentOperation()) setStatusText(message);
    };
    const playlistError = validateSourceUrl(targetPlaylistUrl, true);
    const epgError = validateSourceUrl(targetEpgUrl, false);
    if (playlistError || epgError) {
      reportStatus(playlistError || epgError || 'Invalid source URL.');
      if (navigateToLive) {
        startTransition(() => setActiveSection('Settings'));
      }
      return;
    }

    // A. Download and Parse Playlist
    reportStatus('Refreshing playlist...');
    const playlist = await downloadAndParseM3U(targetPlaylistUrl, reportStatus);
    if (!isCurrentOperation()) return;
    
    // B. Download and Parse EPG Guide
    let guide: EpgGuide = { programsByChannel: {}, displayNames: {}, normalizedNames: {}, issues: [] };
    if (targetEpgUrl.trim()) {
      try {
        reportStatus('Refreshing guide...');
        guide = await downloadAndParseEPG(targetEpgUrl, reportStatus);
        if (!isCurrentOperation()) return;
        if (countEpgPrograms(guide.programsByChannel) === 0) {
          throw new Error('The TV guide contains no valid programmes.');
        }
        setGuideStatusText(`Guide refreshed at ${new Date().toLocaleTimeString()}. ${countEpgPrograms(guide.programsByChannel).toLocaleString()} programmes loaded.`);
      } catch (epgErr) {
        if (!isCurrentOperation()) return;
        console.error('Guide download/parse failed:', epgErr);
        setGuideStatusText('Guide refresh failed. The last valid guide is being kept.');
        guide = epgGuide;
      }
    } else {
      setGuideStatusText('No guide URL configured.');
    }

    if (!isCurrentOperation()) return;

    // Rebuild channels with favorite flags
    const favoriteIds = new Set(favorites);
    const updatedChannels = playlist.channels.map(ch => ({
      ...ch,
      isFavorite: favoriteIds.has(ch.id)
    }));

    setRawChannels(updatedChannels);

    const activeMappings = normalizeQualityMappings(targetQualityMappings || qualityMappings);

    const grouped = groupChannelsByQuality(updatedChannels, activeMappings);
    setChannels(grouped);
    setEpgGuide(guide);
    setCategories(buildCategoryList(grouped));

    setCacheStatusText(`Playlist refreshed at ${new Date().toLocaleTimeString()}. ${playlist.issues.length} warnings.`);
    reportStatus(`Refresh complete. ${updatedChannels.length.toLocaleString()} channels available.`);

    // C. Save Cache Snapshot
    const snapshot: CacheSnapshot = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      playlistUrlHash: sha256Short(targetPlaylistUrl.trim()),
      epgUrlHash: targetEpgUrl ? sha256Short(targetEpgUrl.trim()) : '',
      parserVersion: CACHE_PARSER_VERSION,
      savedAtUtc: new Date().toISOString(),
      channels: updatedChannels,
      programs: Object.values(guide.programsByChannel).flat(),
      epgChannelDisplayNames: guide.displayNames,
      epgNormalizedNameMap: guide.normalizedNames
    };
    ensureIpcSuccess(await window.electron.saveCache(snapshot), 'Failed to save cache.');
    if (!isCurrentOperation()) return;

    // Save settings configuration
    if (options.persistSettings !== false) {
      await saveSettingsInternal(targetPlaylistUrl, targetEpgUrl, volume, favorites, recentChannelIds, activeChannel?.id || '', activeMappings);
    } else {
      await refreshStorageInfo();
    }

    if (navigateToLive) {
      startTransition(() => setActiveSection('Live'));
    }
  }, [activeChannel?.id, epgGuide, qualityMappings, recentChannelIds, refreshStorageInfo, saveSettingsInternal, volume]);

  useEffect(() => {
    refreshSourcesInternalRef.current = refreshSourcesInternal;
  }, [refreshSourcesInternal]);

  const handleSaveSettings = async (payload: SettingsSavePayload) => {
    const mappingsObj = normalizeQualityMappings(payload.qualityMappings);
    const retainedHistory = pruneWatchHistory(watchHistoryRef.current, payload.historyRetentionDays);

    await saveSettingsInternal(
      payload.playlistUrl,
      payload.epgUrl,
      volume,
      Array.from(favoriteChannelIds),
      recentChannelIds,
      activeChannel?.id || '',
      mappingsObj,
      payload
    );

    if (retainedHistory.length !== watchHistoryRef.current.length) {
      ensureIpcSuccess(await window.electron.saveHistory(retainedHistory), 'Failed to save pruned history.');
    }

    setPlaylistUrl(payload.playlistUrl);
    setEpgUrl(payload.epgUrl);
    setQualityMappings(mappingsObj);
    setAutoRefreshHours(payload.autoRefreshHours);
    setAutoplayLastChannel(payload.autoplayLastChannel);
    setHistoryRetentionDays(payload.historyRetentionDays);
    setDiscordRpcEnabled(payload.discordRpcEnabled);
    setDiscordShowChannel(payload.discordShowChannel);
    setDiscordShowProgram(payload.discordShowProgram);
    setDiscordShowArtwork(payload.discordShowArtwork);
    setDiscordClientId(payload.discordClientId);
    setAppearance(payload.appearance);
    setLanguage(payload.language);
    setRecordingDirectory(payload.recordingDirectory);

    const grouped = groupChannelsByQuality(rawChannels, mappingsObj);
    setChannels(grouped);
    setCategories(buildCategoryList(grouped));

    if (retainedHistory.length !== watchHistoryRef.current.length) {
      watchHistoryRef.current = retainedHistory;
      setWatchHistory(retainedHistory);
      setStats(computeStats(retainedHistory, { qualityMappings: mappingsObj }));
    }

  };

  const handleSaveAndRefresh = async (payload: SettingsSavePayload) => {
    await handleSaveSettings(payload);
    await handleRefresh(payload);
  };

  const handleTestSources = async (targetPlaylistUrl: string, targetEpgUrl: string) => {
    const playlistError = validateSourceUrl(targetPlaylistUrl, true);
    const epgError = validateSourceUrl(targetEpgUrl, false);
    if (playlistError || epgError) {
      throw new Error(playlistError || epgError || 'Invalid source URL.');
    }

    setStatusText('Testing playlist source...');
    const playlist = await downloadAndParseM3U(targetPlaylistUrl, (message) => setStatusText(message));
    let programmeCount = 0;

    if (targetEpgUrl.trim()) {
      setStatusText('Testing guide source...');
      const guide = await downloadAndParseEPG(targetEpgUrl, (message) => setStatusText(message));
      programmeCount = countEpgPrograms(guide.programsByChannel);
    }

    setStatusText('Source test complete.');
    return `Source test passed. ${playlist.channels.length.toLocaleString()} channels parsed, ${programmeCount.toLocaleString()} programmes parsed.`;
  };

  const handleClearCache = async () => {
    ensureIpcSuccess(await window.electron.clearCache(), 'Failed to clear cache.');
    setCacheStatusText('No cache loaded');
    await refreshStorageInfo();
  };

  const handleClearHistory = async () => {
    ensureIpcSuccess(await window.electron.clearHistory(), 'Failed to clear history.');
    watchHistoryRef.current = [];
    setWatchHistory([]);
    setStats(computeStats([]));
    await refreshStorageInfo();
  };

  const handleToggleReminder = useCallback(async (channel: Channel, programme: EPGProgram, leadMinutes: Reminder['leadMinutes'] = 10) => {
    const id = `${channel.id}\u0000${programme.startUtc}`;
    const existing = reminders.find(reminder => reminder.id === id);
    const next = existing
      ? reminders.filter(reminder => reminder.id !== id)
      : [...reminders, { id, channelId: channel.id, programmeStartUtc: programme.startUtc, programmeTitle: programme.title, leadMinutes }];
    ensureIpcSuccess(await window.electron.saveReminders(next), 'Failed to save reminder.');
    setReminders(next);
    setStatusText(existing ? 'Reminder removed.' : `Reminder set for ${leadMinutes} minutes before ${programme.title}.`);
  }, [reminders]);

  const handleClearFavorites = async () => {
    setFavoriteChannelIds(new Set());
    await saveSettingsInternal(playlistUrl, epgUrl, volume, [], recentChannelIds, activeChannel?.id || '', qualityMappings);
  };

  const handleClearRecents = async () => {
    setRecentChannelIds([]);
    await saveSettingsInternal(playlistUrl, epgUrl, volume, Array.from(favoriteChannelIds), [], activeChannel?.id || '', qualityMappings);
  };

  const handleImportBackup = async (password: string) => {
    const result = await window.electron.importBackup(password);
    if (!result.ok) {
      if (result.canceled) return false;
      throw new Error(result.error || 'Backup import failed.');
    }
    if (result.warnings?.length) sessionStorage.setItem('freaky-import-notice', result.warnings.join(' '));
    return true;
  };

  // Handle Play Channel
  const playChannel = useCallback(async (channel: Channel, saveState = true, preserveExpanded = false) => {
    try {
      const playbackChannel = attachPlaybackVariants(channel, channels);

      await finishActiveRecording();

      // Close active watch session first
      const previousSessionSave = endCurrentSessionRef.current();

      // Open new channel
      setActiveChannel(playbackChannel);
      if (!preserveExpanded) setPlayerCollapseRequest(current => current + 1);
      setStatusText(`Playing ${playbackChannel.name}.`);

      // Add to recently viewed
      const updatedRecents = [playbackChannel.id, ...recentChannelIds.filter(id => id !== playbackChannel.id)].slice(0, 24);
      setRecentChannelIds(updatedRecents);

      // Start new watch session
      const selectedAtUtc = new Date().toISOString();
      const sessionId = `${Date.now()}-${sha256Short(`${playbackChannel.id}|${selectedAtUtc}`).slice(0, 12)}`;
      const baseChannelName = getChannelBaseNamePreserveCase(playbackChannel.name, qualityMappings) || playbackChannel.name;
      const canonicalBaseName = getChannelBaseName(playbackChannel.name, qualityMappings) || playbackChannel.name;
      activeSessionRef.current = {
        sessionId,
        channelId: playbackChannel.id,
        canonicalChannelId: sha256Short(`${playbackChannel.groupTitle || ''}|${canonicalBaseName}`),
        channelName: playbackChannel.name,
        baseChannelName,
        channelGroup: playbackChannel.groupTitle || '',
        selectedAtUtc,
        startTimeUtc: selectedAtUtc,
        endTimeUtc: selectedAtUtc,
        bytesConsumed: 0,
        playingDurationMs: 0,
        bufferingDurationMs: 0,
        stallCount: 0,
        stallDurationMs: 0,
        streamMode: 'automatic',
        qualityLabel: getChannelQualityLabel(playbackChannel.name, qualityMappings)
      };
      lastBufferingStartedAtMsRef.current = null;
      setActiveSessionId(sessionId);
      setCurrentPlayStartTime(selectedAtUtc);

      if (saveState) {
        await Promise.all([
          previousSessionSave,
          saveSettingsInternal(playlistUrl, epgUrl, volume, Array.from(favoriteChannelIds), updatedRecents, playbackChannel.id, qualityMappings)
        ]);
      } else {
        await previousSessionSave;
      }
    } catch (err) {
      console.error('Play channel failed:', err);
      setStatusText('Playback failed. Stream could not be opened.');
    }
  }, [channels, epgUrl, favoriteChannelIds, playlistUrl, qualityMappings, recentChannelIds, saveSettingsInternal, volume]);

  useEffect(() => window.electron.onReminderNotification(reminder => {
    setStatusText(reminder.body || 'Programme reminder.');
    if (reminder.openChannel) {
      const channel = playableChannelIndex.channelById.get(reminder.channelId);
      if (channel) void playChannel(channel);
    }
  }), [playChannel, playableChannelIndex]);

  useEffect(() => {
    playChannelRef.current = playChannel;
  }, [playChannel]);

  // Handle Stop Playback
  const handleStopPlayback = useCallback(async () => {
    try {
      await window.electron.setWindowFullscreen(false);
    } catch (error) {
      console.warn('Failed to exit fullscreen while stopping playback:', error);
    }
    await finishActiveRecording();
    await endCurrentSessionRef.current();
    setActiveChannel(null);
    setActiveSessionId('');
    setCurrentPlayStartTime('');
    setStatusText('Playback stopped.');
    window.electron.clearDiscordActivity().catch(() => {});
  }, []);

  const handlePlaybackEvent = useCallback((sessionId: string, event: PlaybackSessionEvent) => {
    const session = activeSessionRef.current;
    if (!session || session.sessionId !== sessionId) return;

    const eventMs = Date.parse(event.atUtc);
    if (!Number.isFinite(eventMs)) return;

    if (event.type === 'playing') {
      if (!session.playbackStartedAtUtc) {
        session.playbackStartedAtUtc = event.atUtc;
        session.startTimeUtc = event.atUtc;
        session.startupLatencyMs = Math.max(0, Math.round(event.startupLatencyMs));
      }

      if (lastBufferingStartedAtMsRef.current !== null) {
        const stallMs = Math.max(0, eventMs - lastBufferingStartedAtMsRef.current);
        session.stallDurationMs = (session.stallDurationMs || 0) + stallMs;
        session.bufferingDurationMs = (session.bufferingDurationMs || 0) + stallMs;
        lastBufferingStartedAtMsRef.current = null;
      }

      session.streamMode = event.streamMode || session.streamMode;
      if (event.streamMode === 'copy' || event.streamMode === 'hardware') {
        session.bytesSource = 'proxy';
      }
      session.failureReason = undefined;
      return;
    }

    if (event.type === 'buffering-start' || event.type === 'stalled') {
      if (lastBufferingStartedAtMsRef.current === null) {
        lastBufferingStartedAtMsRef.current = eventMs;
        session.stallCount = (session.stallCount || 0) + 1;
      }
      return;
    }

    if (event.type === 'failure') {
      session.failureReason = event.reason;
      return;
    }

    if (event.type === 'ended') {
      void endCurrentSessionRef.current();
      setCurrentPlayStartTime('');
      window.electron.clearDiscordActivity().catch(() => {});
    }
  }, []);

  // End active session and save to history file
  const endCurrentSession = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) return;

    session.endTimeUtc = new Date().toISOString();
    const endMs = new Date(session.endTimeUtc).getTime();
    const playbackStartMs = session.playbackStartedAtUtc
      ? new Date(session.playbackStartedAtUtc).getTime()
      : NaN;
    const durationMs = Number.isFinite(playbackStartMs) ? Math.max(0, endMs - playbackStartMs) : 0;
    session.playingDurationMs = durationMs;

    if (lastBufferingStartedAtMsRef.current !== null && Number.isFinite(endMs)) {
      const stallMs = Math.max(0, endMs - lastBufferingStartedAtMsRef.current);
      session.stallDurationMs = (session.stallDurationMs || 0) + stallMs;
      session.bufferingDurationMs = (session.bufferingDurationMs || 0) + stallMs;
      lastBufferingStartedAtMsRef.current = null;
    }
    
    // Apply a five-second filter to avoid noise in stats
    const completedSession = { ...session };
    activeSessionRef.current = null;

    if (durationMs >= 5000) {
      const appendedHistory = [...watchHistoryRef.current, completedSession];
      const updatedHistory = pruneWatchHistory(appendedHistory, historyRetentionDays);
      watchHistoryRef.current = updatedHistory;
      startTransition(() => setWatchHistory(updatedHistory));

      try {
        const saved = updatedHistory.length === appendedHistory.length
          ? await window.electron.appendHistory(completedSession)
          : await window.electron.saveHistory(updatedHistory);
        ensureIpcSuccess(saved, 'Failed to save history.');
      } catch (err) {
        console.error('Failed to save history:', err);
      }
    }
  }, [historyRetentionDays]);

  useEffect(() => {
    endCurrentSessionRef.current = endCurrentSession;
  }, [endCurrentSession]);

  useEffect(() => window.electron.onAppBeforeClose(() => {
    void (async () => {
      try {
        await finishActiveRecording();
        await flushPendingVolumeSave();
        await endCurrentSessionRef.current();
      } finally {
        window.electron.confirmAppClose();
      }
    })();
  }), [flushPendingVolumeSave]);

  const handleRecordSessionBytes = useCallback((
    sessionId: string,
    bytes: number,
    source: 'network' | 'direct-estimate' | 'proxy'
  ) => {
    const session = activeSessionRef.current;
    if (session?.sessionId === sessionId) {
      session.bytesConsumed = Math.max(0, Math.round(bytes));
      session.bytesSource = source;
    }
  }, []);

  const handleToggleFavorite = useCallback(async (channel: Channel) => {
    const updated = new Set(favoriteChannelIds);
    const variantIds = getChannelVariantIds(channel);
    const hasFavoriteVariant = variantIds.some(id => updated.has(id));

    if (hasFavoriteVariant) {
      for (const id of variantIds) {
        updated.delete(id);
      }
      setStatusText(`${channel.name} removed from favorites.`);
    } else {
      for (const id of variantIds) {
        updated.add(id);
      }
      setStatusText(`${channel.name} added to favorites.`);
    }
    setFavoriteChannelIds(updated);
    
    await saveSettingsInternal(playlistUrl, epgUrl, volume, Array.from(updated), recentChannelIds, activeChannel?.id || '', qualityMappings);
  }, [activeChannel?.id, epgUrl, favoriteChannelIds, playlistUrl, qualityMappings, recentChannelIds, saveSettingsInternal, volume]);

  const handleVolumeChange = useCallback((newVol: number) => {
    setVolume(newVol);
    pendingVolumeSaveRef.current = async () => {
      const result = await window.electron.patchSettings({ volume: newVol });
      if (!result.ok) throw new Error(result.error || 'Failed to save volume.');
    };

    if (volumeSaveTimerRef.current !== null) {
      window.clearTimeout(volumeSaveTimerRef.current);
    }
    volumeSaveTimerRef.current = window.setTimeout(() => {
      void flushPendingVolumeSave().catch(err => console.error('Failed to save volume:', err));
    }, VOLUME_PERSIST_DEBOUNCE_MS);
  }, [flushPendingVolumeSave]);

  useEffect(() => () => {
    if (volumeSaveTimerRef.current !== null) {
      window.clearTimeout(volumeSaveTimerRef.current);
      volumeSaveTimerRef.current = null;
    }
  }, []);

  // Channel Navigation buttons (prev / next)
  const showZapPreview = useCallback((channel: Channel) => {
    setZapPreview(channel);
    if (zapPreviewTimerRef.current !== null) window.clearTimeout(zapPreviewTimerRef.current);
    zapPreviewTimerRef.current = window.setTimeout(() => {
      setZapPreview(null);
      zapPreviewTimerRef.current = null;
    }, 2000);
  }, []);

  const tuneChannelRelative = useCallback((offset: number) => {
    if (channels.length === 0) return;
    
    const currentIndex = activeChannel
      ? playableChannelIndex.indexById.get(activeChannel.id) ?? -1
      : -1;
      
    const nextIndex = getRelativeChannelIndex(currentIndex, offset, channels.length);
    showZapPreview(channels[nextIndex]);
    void playChannel(channels[nextIndex], true, true);
  }, [activeChannel, channels, playableChannelIndex, playChannel, showZapPreview]);

  const handleNextChannel = useCallback(() => tuneChannelRelative(1), [tuneChannelRelative]);
  const handlePrevChannel = useCallback(() => tuneChannelRelative(-1), [tuneChannelRelative]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (effectiveActiveSection === 'YearReview') return;
      if (event.altKey || event.ctrlKey || event.metaKey || isEditableShortcutTarget(event.target as HTMLElement | null)) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlePrevChannel();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNextChannel();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        handleVolumeChange(nextVolume(volume, 1));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        handleVolumeChange(nextVolume(volume, -1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [effectiveActiveSection, handleNextChannel, handlePrevChannel, handleVolumeChange, volume]);

  const handleRefreshStats = useCallback(async () => {
    const history: WatchSession[] = await window.electron.loadHistory();
    const retainedHistory = pruneWatchHistory(history, historyRetentionDays);
    const mergedHistory = [...retainedHistory];
    if (activeSessionRef.current) {
      const currentActive = {
        ...activeSessionRef.current,
        endTimeUtc: new Date().toISOString()
      };
      mergedHistory.push(currentActive);
    }
    watchHistoryRef.current = retainedHistory;
    setWatchHistory(retainedHistory);
    setStats(computeStats(mergedHistory, { qualityMappings }));
  }, [historyRetentionDays, qualityMappings]);

  const handleCopyStatsCard = useCallback(async (png: Uint8Array) => {
    const result = await window.electron.copyStatisticsCard({ pngBytes: png });
    if (!result.ok) throw new Error(result.error || 'Failed to copy statistics image.');
  }, []);

  const handleSaveStatsCard = useCallback(async (png: Uint8Array) => {
    const result = await window.electron.saveStatisticsCard({
      pngBytes: png,
      suggestedName: `FreakyIPTV_Statistics_${new Date().toISOString().slice(0, 10)}`
    });
    if (!result.ok && !result.canceled) throw new Error(result.error || 'Failed to save statistics image.');
  }, []);

  useEffect(() => {
    if (activeSection !== 'Stats') return;
    const timeoutId = window.setTimeout(() => {
      void handleRefreshStats().catch(err => console.error('Failed to refresh statistics:', err));
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [activeSection, handleRefreshStats]);

  const handleSidebarNavigate = useCallback((section: string) => {
    if (section === 'YearReview' && annualReview) {
      void handleOpenReview(annualReview);
      return;
    }
    handleNavigate(section);
  }, [annualReview, handleNavigate, handleOpenReview]);

  const handleHomeGreetingAction = useCallback((action: HomeGreetingAction) => {
    if (action.kind === 'play-channel') {
      const channel = playableChannelIndex.channelById.get(action.channelId);
      if (channel) {
        void playChannel(channel);
        return;
      }
      handleNavigate('Live');
      return;
    }
    handleNavigate(action.section);
  }, [handleNavigate, playChannel, playableChannelIndex]);

  const renderActiveSection = () => {
    switch (effectiveActiveSection) {
      case 'Live':
        return (
          <LiveGrid
            channels={channels}
            categories={categories}
            activeChannel={activeChannel}
            favoriteChannelIds={favoriteChannelIds}
            onPlayChannel={playChannel}
            onToggleFavorite={handleToggleFavorite}
            getChannelEpgInfo={getChannelEpgInfo}
            qualityMappings={qualityMappings}
            nowMs={epgTickMs}
          />
        );
      case 'Favorites':
        return (
          <LiveGrid
            channels={channels}
            categories={categories}
            activeChannel={activeChannel}
            favoriteChannelIds={favoriteChannelIds}
            onPlayChannel={playChannel}
            onToggleFavorite={handleToggleFavorite}
            getChannelEpgInfo={getChannelEpgInfo}
            showFavoritesOnly={true}
            qualityMappings={qualityMappings}
            nowMs={epgTickMs}
          />
        );
      case 'Guide':
        return (
          <TvGuideTab
            channels={channels}
            onPlayChannel={playChannel}
            getChannelEpgInfo={getChannelEpgInfo}
            reminders={reminders}
            onToggleReminder={handleToggleReminder}
          />
        );
      case 'Stats':
        return stats ? (
          <Suspense fallback={<div role="status" aria-live="polite" className="app-loading-state">Loading stats dashboard...</div>}>
            <StatsTab
              stats={stats}
              onRefreshStats={handleRefreshStats}
              onCopyStatsCard={handleCopyStatsCard}
              onSaveStatsCard={handleSaveStatsCard}
            />
          </Suspense>
        ) : (
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
            Loading stats dashboard...
          </div>
        );
      case 'Recordings':
        return <RecordingsTab />;
      case 'YearReview':
        return annualReview?.annualData ? (
          <Suspense fallback={<div role="status" aria-live="polite" className="app-loading-state">Loading year review...</div>}>
            <AnnualReview data={annualReview.annualData} onExit={() => handleNavigate('Home')} />
          </Suspense>
        ) : null;
      case 'About':
        return <AboutTab />;
      case 'Settings':
        return (
          <SettingsTab
            initialPlaylistUrl={playlistUrl}
            initialEpgUrl={epgUrl}
            initialQualityMappings={qualityMappings}
            initialAutoRefreshHours={autoRefreshHours}
            initialAutoplayLastChannel={autoplayLastChannel}
            initialHistoryRetentionDays={historyRetentionDays}
            initialDiscordRpcEnabled={discordRpcEnabled}
            initialDiscordShowChannel={discordShowChannel}
            initialDiscordShowProgram={discordShowProgram}
            initialDiscordShowArtwork={discordShowArtwork}
            initialDiscordClientId={discordClientId}
            initialAppearance={appearance}
            initialLanguage={language}
            initialRecordingDirectory={recordingDirectory}
            cacheStatus={cacheStatusText}
            guideStatus={guideStatusText}
            statusText={statusText}
            isLoading={isLoading}
            storageInfo={storageInfo}
            favoritesCount={favoritesCount}
            recentCount={recentChannelIds.length}
            onSave={handleSaveSettings}
            onSaveAndRefresh={handleSaveAndRefresh}
            onTestSources={handleTestSources}
            onClearCache={handleClearCache}
            onClearHistory={handleClearHistory}
            onClearFavorites={handleClearFavorites}
            onClearRecents={handleClearRecents}
            onImportBackup={handleImportBackup}
            onDirtyChange={setSettingsDirty}
          />
        );
      case 'Home':
      default:
        return (
          <HomeTab
            greeting={homeGreeting}
            recentChannels={recentChannels}
            activeChannel={activeChannel}
            favoriteChannelIds={favoriteChannelIds}
            onPlayChannel={playChannel}
            onToggleFavorite={handleToggleFavorite}
            getChannelEpgInfo={getChannelEpgInfo}
            onNavigate={handleNavigate}
            onGreetingAction={handleHomeGreetingAction}
            qualityMappings={qualityMappings}
            displayedReview={displayedReview}
            isDisplayedReviewOpened={isDisplayedReviewOpened}
            onOpenReview={(review) => { void handleOpenReview(review); }}
            onDismissReview={(review) => { void handleDismissReview(review); }}
          />
        );
    }
  };

  const sectionTitle = effectiveActiveSection === 'Home' ? 'Home' : effectiveActiveSection === 'YearReview' ? 'Year Review' : effectiveActiveSection;
  const hasStatusError = /failed|error|invalid|could not|unavailable/i.test(statusText);

  return (
    <div 
      className="app-shell"
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        background: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* App Sidebar */}
      <Sidebar
        activeSection={effectiveActiveSection}
        onNavigate={handleSidebarNavigate}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        showYearReview={Boolean(annualReview)}
      />

      {/* Main Content Pane */}
      <main
        className={`app-main-surface ${activeChannel ? 'app-main-surface--compact-player' : ''}`}
        aria-labelledby="active-section-title"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '24px 28px',
          height: '100%',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <h1 id="active-section-title" className="sr-only">{sectionTitle}</h1>
        {hasStatusError && (
          <div className="app-status-alert" role="alert">
            {statusText}
          </div>
        )}
        {zapPreview && (
          <div className="zap-overlay" role="status" aria-live="polite">
            {zapPreview.logoUrl ? <img src={zapPreview.logoUrl} alt="" /> : <div className="zap-overlay-placeholder" />}
            <div>
              <span>{getChannelQualityLabel(zapPreview.name, qualityMappings)}</span>
              <strong>{zapPreview.name}</strong>
              <small>{getChannelEpgInfo(zapPreview).program?.title || 'Live TV'}</small>
            </div>
          </div>
        )}
        {/* Active Tab View */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {isLoading && effectiveActiveSection !== 'Settings' ? (
            <div 
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: '16px'
              }}
            >
              <svg className="animate-spin" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="3.5" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)"/>
                <path d="M4 12a8 8 0 0 1 8-8" />
              </svg>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Loading cache database...
              </span>
            </div>
          ) : (
            renderActiveSection()
          )}
        </div>

        {/* Unified Bottom Expandable Video Player */}
        {activeChannel && (
          <Suspense
            fallback={
              <div
                className="player-shell player-shell--compact"
                style={{
                  marginTop: '16px',
                  justifyContent: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 600
                }}
              >
                Loading player...
              </div>
            }
          >
            <VideoPlayer
              channel={activeChannel}
              volume={volume}
              onVolumeChange={handleVolumeChange}
              onStop={handleStopPlayback}
              onNextChannel={handleNextChannel}
              onPrevChannel={handlePrevChannel}
              sessionId={activeSessionId}
              onRecordSessionBytes={handleRecordSessionBytes}
              collapseRequest={playerCollapseRequest}
              currentProgram={activeChannelEpgInfo.program}
              currentProgress={activeChannelEpgInfo.progress}
              onPlayChannel={playChannel}
              qualityMappings={qualityMappings}
              onPlaybackEvent={handlePlaybackEvent}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
};

export default App;
