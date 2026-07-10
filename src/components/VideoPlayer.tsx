import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPlaybackSessionReporter } from '../services/playbackSessionReporter';
import { classifyPlaybackFailure, playbackFailureMessage, redactPlaybackDiagnostic } from '../services/playbackFailure';
import { normalizeProxyStartResult } from '../services/proxyStartResult';
import { compactPlaybackStateText } from '../services/compactPlaybackState';
import {
  chooseInitialPlaybackEngine,
  evaluatePlaybackStartup,
  forgetRememberedPlaybackEngine,
  getRememberedPlaybackEngine,
  nextAdaptiveBufferState,
  nextPlaybackStartupCheckDelay,
  rememberSuccessfulPlaybackEngine
} from '../services/playbackStartupPolicy';
import type { PlaybackEngine, PlaybackStartupProfile, PlaybackStreamKind } from '../services/playbackStartupPolicy';
import { getChannelQualityLabel } from '../services/utils';

import type { AdaptiveBufferLevel, Channel, EPGProgram, PlaybackAttempt, PlaybackFailure, PlaybackSessionEvent, PlaybackStatus, RecordingState } from '../types';

interface VideoPlayerProps {
  channel: Channel;
  volume: number;
  onVolumeChange: (vol: number) => void;
  onStop: () => void;
  onNextChannel: () => void;
  onPrevChannel: () => void;
  sessionId: string;
  onRecordSessionBytes: (sessionId: string, bytes: number, source: 'network' | 'direct-estimate' | 'proxy') => void;
  collapseRequest: number;
  currentProgram: EPGProgram | null;
  currentProgress: number;
  onPlayChannel: (channel: Channel) => void;
  qualityMappings?: Record<string, string>;
  onPlaybackEvent?: (sessionId: string, event: PlaybackSessionEvent) => void;
}

const TRANSIENT_BUFFERING_INDICATOR_DELAY_MS = 800;
const IMMERSIVE_CONTROLS_AUTO_HIDE_MS = 2600;
const NETWORK_HISTORY_SAMPLE_COUNT = 36;
const ADAPTIVE_STALL_WINDOW_MS = 45_000;
const ADAPTIVE_STALL_THRESHOLD = 3;

const MPEGTS_BUFFER_PROFILES: Record<AdaptiveBufferLevel, {
  stashInitialSize: number;
  liveBufferLatencyMaxLatency: number;
  liveBufferLatencyMinRemain: number;
}> = {
  // stashInitialSize: internal read-ahead buffer for mpegts.js.
  // FHD streams run at 6–8 Mbps, so 384 KB ≈ 0.4 s — too small to decode
  // H.264 High Profile without artefacts. 1 MB ≈ 1.3 s gives a stable margin.
  0: { stashInitialSize: 1024 * 1024,      liveBufferLatencyMaxLatency: 7.0,  liveBufferLatencyMinRemain: 3.5 },
  1: { stashInitialSize: 2 * 1024 * 1024,  liveBufferLatencyMaxLatency: 10.0, liveBufferLatencyMinRemain: 5.0 },
  2: { stashInitialSize: 4 * 1024 * 1024,  liveBufferLatencyMaxLatency: 14.0, liveBufferLatencyMinRemain: 7.0 }
};

const HLS_BUFFER_PROFILES: Record<AdaptiveBufferLevel, {
  liveSyncDuration: number;
  liveMaxLatencyDuration: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
}> = {
  0: { liveSyncDuration: 8, liveMaxLatencyDuration: 30, maxBufferLength: 30, maxMaxBufferLength: 45 },
  1: { liveSyncDuration: 12, liveMaxLatencyDuration: 40, maxBufferLength: 45, maxMaxBufferLength: 60 },
  2: { liveSyncDuration: 16, liveMaxLatencyDuration: 55, maxBufferLength: 60, maxMaxBufferLength: 75 }
};

const formatBitrate = (kbps: number) => {
  if (kbps <= 0) return '0 Kbps';
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} Kbps`;
};

const formatRecordingDuration = (startedAtUtc: string | null, now: number) => {
  if (!startedAtUtc) return '00:00';
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAtUtc)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const formatRecordingBytes = (bytes: number) => `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MB`;

type DestroyablePlayer = {
  destroy: () => void;
};

type HlsConstructor = typeof import('hls.js').default;
type HlsPlayer = InstanceType<HlsConstructor>;
type MpegTsModule = typeof import('mpegts.js').default;
type MpegTsPlayer = ReturnType<MpegTsModule['createPlayer']>;
type VlcProxyMode = 'copy' | 'hardware';

let hlsModulePromise: Promise<HlsConstructor> | null = null;
let mpegTsModulePromise: Promise<MpegTsModule> | null = null;

const loadHlsModule = () => {
  hlsModulePromise ??= import('hls.js').then(module => module.default);
  return hlsModulePromise;
};

const loadMpegTsModule = () => {
  mpegTsModulePromise ??= import('mpegts.js').then(module => {
    module.default.LoggingControl.applyConfig({ enableAll: import.meta.env.DEV });
    return module.default;
  });
  return mpegTsModulePromise;
};

const isHlsStreamUrl = (url: string) => {
  const lower = url.toLowerCase();
  return lower.includes('.m3u8') || lower.includes('m3u8');
};

const isDirectMediaFileUrl = (url: string) => {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.m4v') || lower.endsWith('.mov');
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  channel,
  volume,
  onVolumeChange,
  onStop,
  onNextChannel,
  onPrevChannel,
  sessionId,
  onRecordSessionBytes,
  collapseRequest,
  currentProgram,
  currentProgress,
  onPlayChannel,
  qualityMappings,
  onPlaybackEvent
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsPlayer | null>(null);
  const mpegtsRef = useRef<MpegTsPlayer | null>(null);
  const playerRef = useRef<DestroyablePlayer | null>(null);
  const bytesRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const onRecordSessionBytesRef = useRef(onRecordSessionBytes);
  const onPlaybackEventRef = useRef(onPlaybackEvent);
  const isLocalProxyPlaybackRef = useRef(false);
  const playbackRelayRef = useRef<{ id: string; url: string; sourceUrl: string } | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const fullscreenTransitionTimerRef = useRef<number | null>(null);
  const fullscreenTransitioningRef = useRef(false);
  const isFullscreenRef = useRef(false);
  const immersiveControlsVisibleRef = useRef(true);
  const statsTickInFlightRef = useRef(false);
  const mpegtsSpeedKbpsRef = useRef<number | null>(null);
  const connectionSpeedKbpsRef = useRef(0);
  const adaptiveBufferLevelRef = useRef<AdaptiveBufferLevel>(0);
  const stallEventsRef = useRef<number[]>([]);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferingText, setBufferingText] = useState('Idle');
  const [showStats, setShowStats] = useState(false);
  const [isQualityOpen, setIsQualityOpen] = useState(false);
  const [expandedPresentation, setExpandedPresentation] = useState({ request: collapseRequest, expanded: false });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFullscreenTransitioning, setIsFullscreenTransitioning] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [areImmersiveControlsVisible, setAreImmersiveControlsVisible] = useState(true);
  const [recordingState, setRecordingState] = useState<RecordingState>({ status: 'idle', mode: null, path: null, startedAtUtc: null, bytes: 0, error: null });
  const [recordingClock, setRecordingClock] = useState(() => Date.now());
  const [mediaNotice, setMediaNotice] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('idle');
  const [playbackFailure, setPlaybackFailure] = useState<PlaybackFailure | null>(null);
  const [playbackAttempts, setPlaybackAttempts] = useState<PlaybackAttempt[]>([]);
  const [retryNonce, setRetryNonce] = useState(0);
  
  // Playback statistics state
  const [stats, setStats] = useState({
    resolution: 'Unavailable',
    fps: 'Unavailable',
    inputBitrate: '0 kbps',
    connectionSpeed: '0 Kbps',
    connectionSpeedKbps: 0,
    networkActivity: '0 Kbps',
    networkHistory: [] as number[],
    sessionId,
    readBytes: '0.0 MB',
    bufferHealth: 0,
    droppedFrames: '0',
    videoCodec: 'Unknown',
    audioCodec: 'Unknown'
  });

  const [preMuteVolume, setPreMuteVolume] = useState(80);
  const isExpanded = expandedPresentation.request === collapseRequest && expandedPresentation.expanded;
  const isImmersive = isExpanded || isFullscreen;

  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    immersiveControlsVisibleRef.current = areImmersiveControlsVisible;
  }, [areImmersiveControlsVisible]);

  useEffect(() => {
    onRecordSessionBytesRef.current = onRecordSessionBytes;
  }, [onRecordSessionBytes]);

  useEffect(() => {
    onPlaybackEventRef.current = onPlaybackEvent;
  }, [onPlaybackEvent]);

  useEffect(() => {
    void loadMpegTsModule();
    void loadHlsModule();
  }, []);

  useEffect(() => {
    void window.electron.getRecordingState().then(setRecordingState);
    return window.electron.onRecordingStateChange(setRecordingState);
  }, []);

  useEffect(() => {
    if (recordingState.status !== 'recording' && recordingState.status !== 'finalizing') return;
    const timer = window.setInterval(() => {
      setRecordingClock(Date.now());
      void window.electron.getRecordingState().then(setRecordingState);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recordingState.status]);

  const showMediaNotice = useCallback((message: string) => {
    setMediaNotice(message);
    window.setTimeout(() => setMediaNotice(''), 3500);
  }, []);

  const toggleRecording = useCallback(async () => {
    try {
      if (recordingState.status === 'recording' || recordingState.status === 'finalizing') {
        setRecordingState(current => ({ ...current, status: 'finalizing' }));
        const state = await window.electron.stopSourceRecording();
        setRecordingState(state);
        if (state.status !== 'completed') {
          throw new Error(state.error || 'Recording could not be finalized.');
        }
        showMediaNotice('MKV recording saved.');
        return;
      }
      const relay = playbackRelayRef.current?.sourceUrl === channel.streamUrl ? playbackRelayRef.current : null;
      const result = await window.electron.startSourceRecording({
        sourceUrl: channel.streamUrl,
        channelName: channel.name,
        relayId: relay?.id || null
      });
      if (!result.ok) throw new Error(result.error || 'Recording could not start.');
      showMediaNotice('Recording started.');
    } catch (error) {
      console.error('[VideoPlayer] Recording action failed:', error);
      showMediaNotice(error instanceof Error ? error.message : 'Recording action failed.');
    }
  }, [channel.name, channel.streamUrl, recordingState.status, showMediaNotice]);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setIsCapturing(true);
    try {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error('No video frame is available yet.');
      let result;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is not available.');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        result = await window.electron.capturePlaybackFrame({
          channelName: channel.name,
          pngDataUrl: canvas.toDataURL('image/png')
        });
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error;
        setIsCapturing(true);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const rect = video.getBoundingClientRect();
        result = await window.electron.capturePlaybackFrame({
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          channelName: channel.name
        });
      }
      if (!result.ok) throw new Error(result.error || 'Screenshot could not be saved.');
      showMediaNotice(result.error || 'Screenshot saved and copied to the clipboard.');
    } catch (error) {
      showMediaNotice(error instanceof Error ? error.message : 'Screenshot failed.');
    } finally {
      setIsCapturing(false);
    }
  }, [channel.name, showMediaNotice]);

  useEffect(() => {
    void window.electron.setPlaybackActive(true);
    return () => {
      void window.electron.setPlaybackActive(false);
    };
  }, []);

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  }, []);

  const revealImmersiveControls = useCallback(() => {
    if (!immersiveControlsVisibleRef.current) {
      immersiveControlsVisibleRef.current = true;
      setAreImmersiveControlsVisible(true);
    }
    clearControlsHideTimer();

    if (!isImmersive) return;

    controlsHideTimerRef.current = window.setTimeout(() => {
      immersiveControlsVisibleRef.current = false;
      setAreImmersiveControlsVisible(false);
      controlsHideTimerRef.current = null;
    }, IMMERSIVE_CONTROLS_AUTO_HIDE_MS);
  }, [clearControlsHideTimer, isImmersive]);

  useEffect(() => {
    clearControlsHideTimer();

    if (!isImmersive) {
      immersiveControlsVisibleRef.current = true;
      return;
    }

    const revealTimer = window.setTimeout(revealImmersiveControls, 0);

    return () => {
      window.clearTimeout(revealTimer);
      clearControlsHideTimer();
    };
  }, [clearControlsHideTimer, isImmersive, revealImmersiveControls]);

  useEffect(() => {
    if (!isImmersive) return;

    window.addEventListener('keydown', revealImmersiveControls);
    return () => window.removeEventListener('keydown', revealImmersiveControls);
  }, [isImmersive, revealImmersiveControls]);

  useEffect(() => {
    if (!isQualityOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsQualityOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isQualityOpen]);

  const cleanupPlayers = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        // Best-effort cleanup during channel switches.
      }
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch {
        // Best-effort cleanup during channel switches.
      }
      mpegtsRef.current = null;
    }
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {
        // Best-effort cleanup
      }
      playerRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        video.src = '';
        video.removeAttribute('src');
        video.load();
      } catch {
        // Best-effort cleanup during channel switches.
      }
    }
  }, []);

  // Format program times
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Re-sync video volume when prop changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Periodic video state debugger for console troubleshooting
  useEffect(() => {
    if (window.localStorage.getItem('debugVideo') !== '1') return;

    const logTimer = setInterval(() => {
      const video = videoRef.current;
      if (video) {
        const bufferedRanges = [];
        for (let i = 0; i < video.buffered.length; i++) {
          bufferedRanges.push(`[${video.buffered.start(i).toFixed(2)}, ${video.buffered.end(i).toFixed(2)}]`);
        }
        console.log(`[Video State Debug] paused=${video.paused}, currentTime=${video.currentTime.toFixed(2)}, readyState=${video.readyState}, buffered=[${bufferedRanges.join(', ')}], error=${video.error ? video.error.code : 'none'}`);
      }
    }, 10000);
    return () => clearInterval(logTimer);
  }, []);

  // Main playback logic
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset session bytes tracking
    bytesRef.current = 0;
    mpegtsSpeedKbpsRef.current = null;
    connectionSpeedKbpsRef.current = 0;
    isLocalProxyPlaybackRef.current = false;
    lastTimeRef.current = Date.now();
    setBufferingText('Opening stream');
    setIsPlaying(false);
    setIsBuffering(true);
    setPlaybackStatus('starting');
    setPlaybackFailure(null);
    setPlaybackAttempts([]);

    // Clean up previous instances
    cleanupPlayers();

    let isCancelled = false;
    let hasStartedPlayback = false;
    let startupTimer: number | null = null;
    let proxyTrafficTimer: number | null = null;
    let lastProxyTrafficBytes: number | null = null;
    let bufferingIndicatorTimer: number | null = null;
    let suppressVideoError = false;
    let copyProxyAttempted = false;
    let hardwareProxyAttempted = false;
    let currentProxyMode: VlcProxyMode | null = null;
    let currentEngine: PlaybackAttempt['engine'] | null = null;
    let activeAttemptId = 0;
    let startupAttemptStartedAt = Date.now();
    let firstStartupDataAt: number | null = null;
    let lastStartupDataAt: number | null = null;
    let startupFallback: (() => void | Promise<void>) | null = null;
    let attempts: PlaybackAttempt[] = [];

    const publishAttempts = () => setPlaybackAttempts(attempts.map(attempt => ({ ...attempt })));
    const isCurrentAttempt = (attemptId: number) => !isCancelled && activeAttemptId === attemptId;
    const clearProxyTrafficPolling = () => {
      if (proxyTrafficTimer !== null) {
        window.clearInterval(proxyTrafficTimer);
        proxyTrafficTimer = null;
      }
      lastProxyTrafficBytes = null;
    };
    const failPendingAttempt = (message: string) => {
      const active = attempts.at(-1);
      if (!active || active.result !== 'pending') return;
      active.result = 'failed';
      active.durationMs = Math.max(0, Date.now() - Date.parse(active.startedAtUtc));
      active.failureCode = classifyPlaybackFailure(message);
      publishAttempts();
    };
    const beginAttempt = (engine: PlaybackAttempt['engine']) => {
      failPendingAttempt('Playback engine fallback');
      clearProxyTrafficPolling();
      activeAttemptId += 1;
      currentEngine = engine;
      startupAttemptStartedAt = Date.now();
      firstStartupDataAt = null;
      lastStartupDataAt = null;
      attempts = [...attempts, { engine, startedAtUtc: new Date().toISOString(), result: 'pending' }];
      publishAttempts();
      return activeAttemptId;
    };

    const sourceUrl = channel.streamUrl;
    const isHls = isHlsStreamUrl(sourceUrl);
    const isNativeMediaFile = isDirectMediaFileUrl(sourceUrl);
    const isMpegTs = !isHls && !isNativeMediaFile;
    const streamKind: PlaybackStreamKind = isHls ? 'hls' : (isMpegTs ? 'mpegts' : 'native');
    const qualityLabel = getChannelQualityLabel(channel.name, qualityMappings);
    const shouldUseFastFallback = qualityLabel === 'FHD' || qualityLabel === 'HEVC' || qualityLabel === '4K';
    let activeRelayId: string | null = null;
    let activeRelayUrl: string | null = null;
    const playbackReporter = createPlaybackSessionReporter(
      sessionId,
      (reportedSessionId, event) => onPlaybackEventRef.current?.(reportedSessionId, event)
    );

    const getCurrentStreamMode = () => currentProxyMode
      || (isHls ? 'hls' : (isNativeMediaFile ? 'native' : (activeRelayId ? 'mpegts-relay' : 'direct')));

    const clearStartupTimer = () => {
      if (startupTimer !== null) {
        window.clearTimeout(startupTimer);
        startupTimer = null;
      }
    };

    const clearBufferingIndicatorTimer = () => {
      if (bufferingIndicatorTimer !== null) {
        window.clearTimeout(bufferingIndicatorTimer);
        bufferingIndicatorTimer = null;
      }
    };

    const showBufferingIndicator = (text = 'Buffering') => {
      clearBufferingIndicatorTimer();

      if (!hasStartedPlayback) {
        setBufferingText(text);
        setIsBuffering(true);
        setPlaybackStatus('starting');
        return;
      }

      bufferingIndicatorTimer = window.setTimeout(() => {
        if (isCancelled) return;
        setBufferingText(text);
        setIsBuffering(true);
        setPlaybackStatus('buffering');
      }, TRANSIENT_BUFFERING_INDICATOR_DELAY_MS);
    };

    const markPlaybackFailed = (message = 'Playback error') => {
      if (isCancelled) return;
      clearStartupTimer();
      clearProxyTrafficPolling();
      clearBufferingIndicatorTimer();
      setIsBuffering(false);
      setBufferingText(message);
      setIsPlaying(false);
      failPendingAttempt(message);
      const code = classifyPlaybackFailure(message);
      setPlaybackStatus('failed');
      setPlaybackFailure({ code, message: playbackFailureMessage(code), attempts: attempts.map(attempt => ({ ...attempt })) });
      playbackReporter.failure(message);
    };

    const resetForRetry = () => {
      suppressVideoError = true;
      cleanupPlayers();
      window.setTimeout(() => {
        suppressVideoError = false;
      }, 0);
    };

    const playAttachedMedia = () => {
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch((e: unknown) => {
          const err = e as Error;
          console.warn('[VideoPlayer] Direct/HLS Autoplay prevented:', {
            name: err?.name,
            message: err?.message,
            stack: err?.stack
          });
          if (!isCancelled && !hasStartedPlayback && err?.name !== 'AbortError') {
            setIsBuffering(false);
            setBufferingText('Click to start playback');
          }
        });
      }
    };

    const playElementUrl = (url: string) => {
      video.src = url;
      playAttachedMedia();
    };

    const getStartupProfile = (): PlaybackStartupProfile => {
      if (currentProxyMode) return 'proxy';
      return shouldUseFastFallback ? 'fast-fallback' : 'default';
    };

    const scheduleStartupCheck = () => {
      clearStartupTimer();
      const scheduledAttemptId = activeAttemptId;
      const now = Date.now();
      const snapshot = {
        now,
        attemptStartedAt: startupAttemptStartedAt,
        firstDataAt: firstStartupDataAt,
        lastDataAt: lastStartupDataAt,
        hasFirstFrame: hasStartedPlayback,
        profile: getStartupProfile()
      };
      const delay = nextPlaybackStartupCheckDelay(snapshot);
      if (delay === null) return;
      startupTimer = window.setTimeout(() => {
        if (!isCurrentAttempt(scheduledAttemptId) || hasStartedPlayback) return;
        const action = evaluatePlaybackStartup({
          now: Date.now(),
          attemptStartedAt: startupAttemptStartedAt,
          firstDataAt: firstStartupDataAt,
          lastDataAt: lastStartupDataAt,
          hasFirstFrame: hasStartedPlayback,
          profile: getStartupProfile()
        });
        if (action === 'fallback' && startupFallback) {
          void startupFallback();
        } else if (action === 'network-error') {
          if (currentProxyMode && startupFallback) {
            void startupFallback();
            return;
          }
          markPlaybackFailed('No stream network data received');
        } else {
          scheduleStartupCheck();
        }
      }, delay);
    };

    const armStartupTimeout = (onFallback: () => void | Promise<void>) => {
      const fallbackAttemptId = activeAttemptId;
      startupFallback = () => {
        if (!isCurrentAttempt(fallbackAttemptId)) return;
        return onFallback();
      };
      scheduleStartupCheck();
    };

    const noteStartupData = (attemptId = activeAttemptId) => {
      if (!isCurrentAttempt(attemptId) || hasStartedPlayback) return;
      const now = Date.now();
      if (firstStartupDataAt === null) firstStartupDataAt = now;
      lastStartupDataAt = now;
      scheduleStartupCheck();
    };

    const startProxyTrafficPolling = (attemptId: number) => {
      clearProxyTrafficPolling();
      const poll = async () => {
        if (!isCurrentAttempt(attemptId) || hasStartedPlayback) {
          clearProxyTrafficPolling();
          return;
        }
        try {
          const bytes = Number(await window.electron.getProxyTraffic());
          if (!Number.isFinite(bytes) || bytes < 0) return;
          if (lastProxyTrafficBytes === null) {
            lastProxyTrafficBytes = bytes;
            if (bytes > 0) noteStartupData(attemptId);
            return;
          }
          if (bytes > lastProxyTrafficBytes) {
            lastProxyTrafficBytes = bytes;
            noteStartupData(attemptId);
          }
        } catch (error) {
          console.warn('[VideoPlayer] Failed to poll proxy startup traffic:', error);
        }
      };
      void poll();
      proxyTrafficTimer = window.setInterval(() => {
        void poll();
      }, 250);
    };

    const ensurePlaybackRelay = async () => {
      if (activeRelayId && activeRelayUrl) return { relayId: activeRelayId, url: activeRelayUrl };
      const relayResult = await window.electron.startPlaybackRelay(sourceUrl);
      if (!relayResult.ok || !relayResult.relayId || !relayResult.url) {
        throw new Error(relayResult.error || 'The live stream relay could not start.');
      }
      activeRelayId = relayResult.relayId;
      activeRelayUrl = relayResult.url;
      playbackRelayRef.current = { id: activeRelayId, url: activeRelayUrl, sourceUrl };
      return { relayId: activeRelayId, url: activeRelayUrl };
    };

    const hlsBufferProfile = () => HLS_BUFFER_PROFILES[adaptiveBufferLevelRef.current];
    const mpegTsBufferProfile = () => MPEGTS_BUFFER_PROFILES[adaptiveBufferLevelRef.current];

    const startMpegTsPlayback = async (
      url: string,
      allowVlcFallback: boolean,
      proxyMode: VlcProxyMode | null = null
    ) => {
      const attemptId = activeAttemptId;
      currentProxyMode = proxyMode;
      isLocalProxyPlaybackRef.current = proxyMode !== null;
      setBufferingText('Opening stream');
      setIsBuffering(true);

      const mpegts = await loadMpegTsModule();
      if (!isCurrentAttempt(attemptId)) return;

      if (!mpegts.isSupported()) {
        if (allowVlcFallback && !copyProxyAttempted) {
          void startVlcProxyPlayback('Starting compatibility video engine...', false, 'copy');
          return;
        }
        if (proxyMode === 'copy' && !hardwareProxyAttempted) {
          void startVlcProxyPlayback('Retrying with GPU video engine...', false, 'hardware');
          return;
        }
        playElementUrl(url);
        armStartupTimeout(() => markPlaybackFailed('Stream data could not be decoded'));
        return;
      }

      const mpegTsProfile = mpegTsBufferProfile();
      const player = mpegts.createPlayer({
        type: 'mpegts',
        url,
        isLive: true
      }, {
        enableStashBuffer: true,
        stashInitialSize: mpegTsProfile.stashInitialSize,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: mpegTsProfile.liveBufferLatencyMaxLatency,
        liveBufferLatencyMinRemain: mpegTsProfile.liveBufferLatencyMinRemain,
        enableWorker: true,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 30,
        fixAudioTimestampGap: true
      });

      mpegtsRef.current = player;
      player.attachMediaElement(video);
      player.load();
      const playPromise = player.play();
      if (playPromise) {
        playPromise.catch((e: unknown) => {
          if (!isCurrentAttempt(attemptId)) return;
          const err = e as Error;
          console.warn(`[VideoPlayer] MPEG-TS play() rejected (${err?.name || 'UnknownError'}): ${err?.message || 'No error message'}`);
          if (!isCancelled && !hasStartedPlayback && err?.name !== 'AbortError') {
            setIsBuffering(false);
            setBufferingText('Click to start playback');
          }
        });
      }

      player.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
        if (!isCurrentAttempt(attemptId) || !allowVlcFallback || copyProxyAttempted) return;
        
        // If audio is present but not a supported format (like AC3/EAC3 or MP3 in some Chromium builds), fallback to VLC
        const codecStr = mediaInfo.audioCodec ? mediaInfo.audioCodec.toLowerCase() : '';
        const audioUnsupported = mediaInfo.hasAudio && codecStr && !codecStr.includes('aac') && !codecStr.includes('mp4a');
        
        if (audioUnsupported) {
          console.warn(`Unsupported audio codec (${mediaInfo.audioCodec}), falling back to low CPU proxy`);
          window.setTimeout(() => {
            if (!isCurrentAttempt(attemptId)) return;
            void startVlcProxyPlayback('Starting compatibility video engine...', false, 'copy');
          }, 0);
        }
      });

      player.on(mpegts.Events.STATISTICS_INFO, (statisticsInfo: { speed?: number }) => {
        if (!isCurrentAttempt(attemptId)) return;
        const speedKBps = Number(statisticsInfo.speed);
        if (!Number.isFinite(speedKBps) || speedKBps <= 0) return;
        noteStartupData(attemptId);
        mpegtsSpeedKbpsRef.current = speedKBps * 8;
      });

      player.on(mpegts.Events.ERROR, (type, detail, info) => {
        if (!isCurrentAttempt(attemptId)) return;
        console.error('MPEGTS error:', type, detail, info);
        const errorText = `${String(type)} ${String(detail)}`.toLowerCase();
        if (errorText.includes('network') && !hasStartedPlayback && tryProxyRecovery('Retrying through compatibility video engine...')) {
          return;
        }
        if (errorText.includes('network')) {
          markPlaybackFailed('Stream network error');
          return;
        }
        if (proxyMode === 'copy' && !hardwareProxyAttempted) {
          window.setTimeout(() => {
            if (!isCurrentAttempt(attemptId)) return;
            void startVlcProxyPlayback('Retrying with GPU video engine...', false, 'hardware');
          }, 0);
          return;
        }
        if (proxyMode === 'hardware' && !copyProxyAttempted) {
          window.setTimeout(() => {
            if (!isCurrentAttempt(attemptId)) return;
            void startVlcProxyPlayback('Retrying through compatibility video engine...', false, 'copy');
          }, 0);
          return;
        }
        if (allowVlcFallback && !copyProxyAttempted) {
          window.setTimeout(() => {
            if (!isCurrentAttempt(attemptId)) return;
            void startVlcProxyPlayback('Starting compatibility video engine...', false, 'copy');
          }, 0);
          return;
        }
        if (allowVlcFallback && !hardwareProxyAttempted) {
          window.setTimeout(() => {
            if (!isCurrentAttempt(attemptId)) return;
            void startVlcProxyPlayback('Starting GPU video engine...', false, 'hardware');
          }, 0);
          return;
        }
        markPlaybackFailed();
      });

      armStartupTimeout(() => {
        if (proxyMode === 'copy' && !hardwareProxyAttempted) {
          return startVlcProxyPlayback('Retrying with GPU video engine...', false, 'hardware');
        }
        if (proxyMode === 'hardware' && !copyProxyAttempted) {
          return startVlcProxyPlayback('Retrying through compatibility video engine...', false, 'copy');
        }
        if (allowVlcFallback && !copyProxyAttempted) {
          return startVlcProxyPlayback('Starting compatibility video engine...', false, 'copy');
        }
        if (allowVlcFallback && !hardwareProxyAttempted) {
          return startVlcProxyPlayback('Starting GPU video engine...', false, 'hardware');
        }
        markPlaybackFailed('Playback timeout');
      });
    };

    const startVlcProxyPlayback = async (
      message: string,
      allowDirectFallback: boolean,
      mode: VlcProxyMode = 'copy'
    ) => {
      if (isCancelled) return;
      if (mode === 'copy' && copyProxyAttempted) return;
      if (mode === 'hardware' && hardwareProxyAttempted) return;

      if (import.meta.env.DEV) console.warn(`[VideoPlayer] Requesting FFmpeg ${mode} proxy`);
      if (mode === 'copy') {
        copyProxyAttempted = true;
      } else {
        hardwareProxyAttempted = true;
      }
      const attemptId = beginAttempt(mode === 'copy' ? 'proxy-copy' : 'proxy-hardware');
      setPlaybackStatus('recovering');
      clearStartupTimer();
      resetForRetry();
      setBufferingText(message);
      setIsBuffering(true);

      if (isMpegTs && !activeRelayId) {
        try {
          await ensurePlaybackRelay();
        } catch (error) {
          console.warn('[VideoPlayer] Proxy will start without shared playback relay:', error);
        }
      }

      const proxyResult = normalizeProxyStartResult(await window.electron.startVlcProxy(sourceUrl, { mode, relayId: activeRelayId }));
      if (!isCurrentAttempt(attemptId)) return;

      if (!proxyResult.ok || !proxyResult.url) {
        if (allowDirectFallback) {
          console.warn('[VideoPlayer] VLC proxy unavailable, falling back to direct MPEG-TS playback');
          void startMpegTsPlayback(activeRelayUrl || sourceUrl, false);
          return;
        }

        if (getRememberedPlaybackEngine(sourceUrl, window.localStorage) === `proxy-${mode}`) {
          forgetRememberedPlaybackEngine(sourceUrl, window.localStorage);
          if (isHls) {
            beginAttempt('hls');
            void startHlsPlayback();
          } else if (isMpegTs) {
            beginAttempt('mpegts');
            void startMpegTsPlayback(activeRelayUrl || sourceUrl, true);
          } else {
            beginAttempt('native');
            playElementUrl(sourceUrl);
            armStartupTimeout(() => startVlcProxyPlayback(
              'Retrying through compatibility video engine...',
              false,
              mode === 'copy' ? 'hardware' : 'copy'
            ));
          }
          return;
        }

        markPlaybackFailed(proxyResult.error || 'Compatibility proxy failed');
        return;
      }

      console.warn('[VideoPlayer] Playing FFmpeg proxy stream via mpegts.js...');
      void startMpegTsPlayback(proxyResult.url, false, mode);
      startProxyTrafficPolling(attemptId);
    };

    const tryProxyRecovery = (message: string) => {
      if (currentProxyMode === 'copy' && !hardwareProxyAttempted) {
        void startVlcProxyPlayback('Retrying with GPU video engine...', false, 'hardware');
        return true;
      }
      if (currentProxyMode === 'hardware' && !copyProxyAttempted) {
        void startVlcProxyPlayback(message, false, 'copy');
        return true;
      }
      if (!copyProxyAttempted) {
        void startVlcProxyPlayback(message, false, 'copy');
        return true;
      }
      if (!hardwareProxyAttempted) {
        void startVlcProxyPlayback('Retrying with GPU video engine...', false, 'hardware');
        return true;
      }
      return false;
    };

    const startHlsPlayback = async () => {
      const attemptId = activeAttemptId;
      setBufferingText('Opening stream');
      setIsBuffering(true);

      const Hls = await loadHlsModule();
      if (!isCurrentAttempt(attemptId)) return;

      if (Hls.isSupported()) {
        const hlsProfile = hlsBufferProfile();
        const hls = new Hls({
          liveSyncDuration: hlsProfile.liveSyncDuration,
          liveMaxLatencyDuration: hlsProfile.liveMaxLatencyDuration,
          maxLiveSyncPlaybackRate: 1,
          startLevel: -1,
          maxBufferLength: hlsProfile.maxBufferLength,
          maxMaxBufferLength: hlsProfile.maxMaxBufferLength,
          maxBufferSize: 60 * 1000 * 1000,
          backBufferLength: 15,
          maxBufferHole: 0.5,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          enableWorker: true
        });
        hlsRef.current = hls;
        hls.loadSource(sourceUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!isCurrentAttempt(attemptId)) return;
          playAttachedMedia();
        });
        
        hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
          if (!isCurrentAttempt(attemptId)) return;
          noteStartupData(attemptId);
          bytesRef.current += data.payload.byteLength;
          onRecordSessionBytesRef.current(sessionId, bytesRef.current, 'network');
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!isCurrentAttempt(attemptId)) return;
          if (!data.fatal) return;

          console.error('Fatal HLS error:', data);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !hasStartedPlayback && tryProxyRecovery('Retrying through compatibility video engine...')) {
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            markPlaybackFailed('Stream network error');
            return;
          }
          void startVlcProxyPlayback('Retrying through compatibility video engine...', false, 'copy');
        });

        armStartupTimeout(() => startVlcProxyPlayback('Retrying through compatibility video engine...', false, 'copy'));
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        playElementUrl(sourceUrl);
        armStartupTimeout(() => startVlcProxyPlayback('Retrying through compatibility video engine...', false, 'copy'));
      } else {
        void startVlcProxyPlayback('Starting compatibility video engine...', false, 'copy');
      }
    };

    const startInitialEngine = (engine: PlaybackEngine) => {
      if (engine === 'proxy-copy' || engine === 'proxy-hardware') {
        const message = getRememberedPlaybackEngine(sourceUrl, window.localStorage) === engine
          ? 'Opening with the last working video engine...'
          : 'Opening with GPU video engine...';
        void startVlcProxyPlayback(message, false, engine === 'proxy-copy' ? 'copy' : 'hardware');
        return;
      }

      if (engine === 'hls') {
        beginAttempt('hls');
        void startHlsPlayback();
        return;
      }

      if (engine === 'mpegts') {
        beginAttempt('mpegts');
        void (async () => {
          try {
            const relay = await ensurePlaybackRelay();
            if (isCancelled) return;
            void startMpegTsPlayback(relay.url, true);
          } catch (error) {
            console.warn('[VideoPlayer] Playback relay unavailable, falling back to direct MPEG-TS playback:', error);
            if (!isCancelled) void startMpegTsPlayback(sourceUrl, true);
          }
        })();
        return;
      }

      beginAttempt('native');
      playElementUrl(sourceUrl);
      armStartupTimeout(() => startVlcProxyPlayback('Retrying through compatibility video engine...', false, 'copy'));
    };

    const setupPlayer = () => {
      startInitialEngine(chooseInitialPlaybackEngine({
        sourceUrl,
        streamKind,
        qualityLabel,
        platform: window.electron.platform,
        storage: window.localStorage
      }));
    };

    const jumpBufferGaps = () => {
      if (!video || video.buffered.length === 0) return;
      const currentTime = video.currentTime;
      
      // 1. Check if we are behind the first buffered range (classic PTS gap at startup)
      const firstStart = video.buffered.start(0);
      if (currentTime < firstStart - 0.1) {
        console.warn(`[Gap Skipper] Jumping to start of first buffer range: ${currentTime.toFixed(2)} -> ${(firstStart + 0.2).toFixed(2)}`);
        video.currentTime = firstStart + 0.2;
        return;
      }
      
      // 2. Check if we are stuck in a gap between buffered ranges, or right at the end of a range with a new range starting soon
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        
        // If we are currently inside this buffered range, check if we are near the end of it and the next range starts soon
        if (currentTime >= start && currentTime <= end) {
          if (end - currentTime < 0.3 && i + 1 < video.buffered.length) {
            const nextStart = video.buffered.start(i + 1);
            const gapSize = nextStart - end;
            if (gapSize > 0 && gapSize <= 1.5) {
              console.warn(`[Gap Skipper] Jumping over gap between ranges ${i} and ${i+1}: ${currentTime.toFixed(2)} -> ${(nextStart + 0.2).toFixed(2)} (gap: ${gapSize.toFixed(2)}s)`);
              video.currentTime = nextStart + 0.2;
              return;
            }
          }
        }
        
        // If we are in a gap between range i-1 and range i
        if (i > 0) {
          const prevEnd = video.buffered.end(i - 1);
          if (currentTime > prevEnd && currentTime < start) {
            const gapSize = start - prevEnd;
            if (gapSize > 0 && gapSize <= 1.5) {
              console.warn(`[Gap Skipper] Jumping over gap from within gap: ${currentTime.toFixed(2)} -> ${(start + 0.2).toFixed(2)} (gap: ${gapSize.toFixed(2)}s)`);
              video.currentTime = start + 0.2;
              return;
            }
          }
        }
      }
    };

    const increaseAdaptiveBufferIfNeeded = () => {
      const now = Date.now();
      const nextBufferState = nextAdaptiveBufferState({
        now,
        currentLevel: adaptiveBufferLevelRef.current,
        stallEvents: stallEventsRef.current,
        hasStartedPlayback,
        windowMs: ADAPTIVE_STALL_WINDOW_MS,
        threshold: ADAPTIVE_STALL_THRESHOLD
      });

      adaptiveBufferLevelRef.current = nextBufferState.level;
      stallEventsRef.current = nextBufferState.stallEvents;
      if (!nextBufferState.increased) return;
      setBufferingText('Increasing live buffer');

      if (hlsRef.current) {
        const profile = hlsBufferProfile();
        hlsRef.current.config.liveSyncDuration = profile.liveSyncDuration;
        hlsRef.current.config.liveMaxLatencyDuration = profile.liveMaxLatencyDuration;
        hlsRef.current.config.maxBufferLength = profile.maxBufferLength;
        hlsRef.current.config.maxMaxBufferLength = profile.maxMaxBufferLength;
        return;
      }
    };

    // Video events listeners
    const handlePlaying = () => {
      console.log('[VideoPlayer] Video playing event fired. Playback successfully started.');
      const alreadyStarted = hasStartedPlayback;
      hasStartedPlayback = true;
      stallEventsRef.current = [];
      clearStartupTimer();
      clearProxyTrafficPolling();
      clearBufferingIndicatorTimer();
      setIsPlaying(true);
      setIsBuffering(false);
      setBufferingText('Playing');
      if (alreadyStarted) return;

      const activeAttempt = attempts.at(-1);
      if (activeAttempt) {
        activeAttempt.result = 'playing';
        activeAttempt.durationMs = Math.max(0, Date.now() - Date.parse(activeAttempt.startedAtUtc));
        publishAttempts();
      }
      setPlaybackStatus('playing');
      setPlaybackFailure(null);
      if (currentEngine) rememberSuccessfulPlaybackEngine(sourceUrl, currentEngine, window.localStorage);
      playbackReporter.playing(getCurrentStreamMode());
    };
    
    const handleWaiting = () => {
      if (!hasStartedPlayback) {
        jumpBufferGaps();
        return;
      }
      playbackReporter.bufferingStart();
      showBufferingIndicator();
      increaseAdaptiveBufferIfNeeded();
      jumpBufferGaps();
    };

    const handleStalled = () => {
      if (!hasStartedPlayback) {
        jumpBufferGaps();
        return;
      }
      playbackReporter.stalled();
      showBufferingIndicator();
      increaseAdaptiveBufferIfNeeded();
      jumpBufferGaps();
    };

    const handleEnded = () => {
      clearBufferingIndicatorTimer();
      setIsBuffering(false);
      setBufferingText('Stream ended');
      setIsPlaying(false);
      setPlaybackStatus('idle');
      playbackReporter.ended();
    };

    const handleError = () => {
      if (isCancelled || suppressVideoError) return;

      const error = video.error;
      console.error('[VideoPlayer] Video element error event:', error ? { code: error.code, message: error.message } : 'unknown error');
      if (!error || error.code === 1) {
        return;
      }

      if (error.code === MediaError.MEDIA_ERR_NETWORK && !hasStartedPlayback && tryProxyRecovery('Retrying through compatibility video engine...')) {
        return;
      }

      if (error.code === MediaError.MEDIA_ERR_NETWORK) {
        markPlaybackFailed('Stream network error');
        return;
      }

      if (currentProxyMode === 'copy' && !hardwareProxyAttempted) {
        void startVlcProxyPlayback('Retrying with GPU video engine...', false, 'hardware');
        return;
      }

      if (!copyProxyAttempted) {
        void startVlcProxyPlayback('Retrying through compatibility video engine...', isMpegTs, 'copy');
        return;
      }

      if (!hardwareProxyAttempted) {
        void startVlcProxyPlayback('Starting GPU video engine...', false, 'hardware');
        return;
      }

      markPlaybackFailed();
    };

    const handleProgress = () => {
      if (video.buffered.length > 0) noteStartupData();
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('stalled', handleStalled);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('progress', handleProgress);

    // Aggressive PTS Gap Skipper for proxy streams
    const gapSkipperInterval = setInterval(() => {
      if (video) {
        const prevTime = video.currentTime;
        jumpBufferGaps();
        if (video.currentTime !== prevTime) {
          video.play().catch(e => console.warn('Play interrupted:', e));
        }
      }
    }, 500);

    setupPlayer();

    return () => {
      isCancelled = true;
      clearStartupTimer();
      clearProxyTrafficPolling();
      clearBufferingIndicatorTimer();
      window.electron.stopVlcProxy().catch(() => {});
      const relayIdToStop = activeRelayId;
      if (relayIdToStop) {
        window.electron.stopPlaybackRelay(relayIdToStop).catch(() => {});
        if (playbackRelayRef.current?.id === relayIdToStop) playbackRelayRef.current = null;
      }
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('stalled', handleStalled);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('progress', handleProgress);
      clearInterval(gapSkipperInterval);
      cleanupPlayers();
    };
  }, [channel.name, channel.streamUrl, cleanupPlayers, qualityMappings, retryNonce, sessionId]);

  // Periodic statistics updater timer
  useEffect(() => {
    let lastFrameCount = videoRef.current?.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    let lastTime = Date.now();
    let lastBytes = bytesRef.current;

    const tick = async () => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || statsTickInFlightRef.current) return;
      statsTickInFlightRef.current = true;

      try {

      const now = Date.now();
      const timeDiffSec = (now - lastTime) / 1000;
      lastTime = now;

      // Byte accounting is kept active at a lower frequency even when the
      // diagnostics panel is hidden. The remaining metrics are display-only.
      if (isLocalProxyPlaybackRef.current) {
        try {
          const bytes = await window.electron.getProxyTraffic();
          if (bytes !== null && bytes !== undefined && bytes > 0) {
            bytesRef.current = bytes;
            onRecordSessionBytesRef.current(sessionId, bytesRef.current, 'proxy');
          }
        } catch (err) {
          console.warn('Failed to get proxy traffic:', err);
        }
      } else if (playbackRelayRef.current?.sourceUrl === channel.streamUrl) {
        try {
          const bytes = await window.electron.getPlaybackRelayTraffic(playbackRelayRef.current.id);
          if (bytes !== null && bytes !== undefined && bytes > 0) {
            bytesRef.current = bytes;
            onRecordSessionBytesRef.current(sessionId, bytesRef.current, 'network');
          }
        } catch (err) {
          console.warn('Failed to get playback relay traffic:', err);
        }
      } else {
        const measuredMpegTsKbps = mpegtsSpeedKbpsRef.current;
        if (!hlsRef.current && measuredMpegTsKbps && measuredMpegTsKbps > 0) {
          bytesRef.current += Math.round(((measuredMpegTsKbps * 1024) / 8) * timeDiffSec);
          onRecordSessionBytesRef.current(sessionId, bytesRef.current, 'direct-estimate');
        }
      }

      const bytesDiff = bytesRef.current - lastBytes;
      lastBytes = bytesRef.current;
      if (!showStats && !isBuffering) return;

      // Extract resolution
      const resolution = video.videoWidth > 0 && video.videoHeight > 0
        ? `${video.videoWidth}x${video.videoHeight}`
        : 'Unavailable';

      // Estimate FPS and Dropped Frames
      let fpsText = 'Unavailable';
      let droppedText = '0';
      if (video.getVideoPlaybackQuality) {
        const quality = video.getVideoPlaybackQuality();
        const frameDiff = quality.totalVideoFrames - lastFrameCount;
        lastFrameCount = quality.totalVideoFrames;

        if (timeDiffSec > 0) {
          const fps = Math.round(frameDiff / timeDiffSec);
          fpsText = fps > 0 ? `${fps} fps` : 'Unavailable';
        }
        droppedText = quality.droppedVideoFrames.toString();
      }

      const curBitrateKbps = timeDiffSec > 0 ? Math.round((bytesDiff * 8) / (1024 * timeDiffSec)) : 0;
      if (curBitrateKbps > 0) {
        connectionSpeedKbpsRef.current = connectionSpeedKbpsRef.current > 0
          ? Math.round((connectionSpeedKbpsRef.current * 0.72) + (curBitrateKbps * 0.28))
          : curBitrateKbps;
      }
      
      const inputBitrate = curBitrateKbps > 0 ? formatBitrate(curBitrateKbps) : 'Measuring';

      const readBytes = `${(bytesRef.current / (1024 * 1024)).toFixed(1)} MB`;

      // Buffer Percentage
      let bufferHealth = 0;
      if (video.buffered.length > 0) {
        const curTime = video.currentTime;
        let bufEnd = curTime;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= curTime && video.buffered.end(i) >= curTime) {
            bufEnd = video.buffered.end(i);
            break;
          }
        }
        bufferHealth = Math.max(0, bufEnd - curTime);
        const percent = Math.min(100, Math.round((bufferHealth / 10) * 100));
        
        if (isBuffering) {
          const nextBufferingText = `Buffering ${percent}%`;
          setBufferingText(current => current === nextBufferingText ? current : nextBufferingText);
        }
      }

      // Codecs detection
      let videoCodec = 'Unknown';
      let audioCodec = 'Unknown';
      if (hlsRef.current) {
        const activeLevel = hlsRef.current.levels[hlsRef.current.currentLevel];
        if (activeLevel) {
          const codecStr = activeLevel.attrs.CODECS || '';
          const parts = codecStr.split(',');
          if (parts[0]) videoCodec = parts[0].trim().split('.')[0];
          if (parts[1]) audioCodec = parts[1].trim().split('.')[0];
        }
      } else if (mpegtsRef.current) {
        videoCodec = 'h264';
        audioCodec = 'aac';
      } else {
        videoCodec = 'h264';
        audioCodec = 'aac';
      }

      if (showStats) {
        setStats(current => ({
          resolution,
          fps: fpsText,
          inputBitrate,
          connectionSpeed: formatBitrate(connectionSpeedKbpsRef.current),
          connectionSpeedKbps: connectionSpeedKbpsRef.current,
          networkActivity: formatBitrate(curBitrateKbps),
          networkHistory: current.sessionId === sessionId
            ? [...current.networkHistory, curBitrateKbps].slice(-NETWORK_HISTORY_SAMPLE_COUNT)
            : [curBitrateKbps],
          sessionId,
          readBytes,
          bufferHealth,
          droppedFrames: droppedText,
          videoCodec,
          audioCodec
        }));
      }
      } finally {
        statsTickInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void tick();
    }, showStats || isBuffering ? 1000 : 5000);

    return () => clearInterval(timer);
  }, [channel.streamUrl, isPlaying, isBuffering, sessionId, showStats]);

  const handleMuteToggle = () => {
    if (volume > 0) {
      setPreMuteVolume(volume);
      onVolumeChange(0);
    } else {
      onVolumeChange(preMuteVolume > 0 ? preMuteVolume : 80);
    }
  };

  const handlePipToggle = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error('PIP Toggle failed:', err);
    }
  };

  const handleFullscreenToggle = async () => {
    if (fullscreenTransitioningRef.current) return;
    fullscreenTransitioningRef.current = true;
    setIsFullscreenTransitioning(true);
    const requestedFullscreen = !isFullscreenRef.current;
    if (requestedFullscreen && !immersiveControlsVisibleRef.current) {
      immersiveControlsVisibleRef.current = true;
      setAreImmersiveControlsVisible(true);
    }

    if (fullscreenTransitionTimerRef.current !== null) {
      window.clearTimeout(fullscreenTransitionTimerRef.current);
    }
    fullscreenTransitionTimerRef.current = window.setTimeout(() => {
      fullscreenTransitionTimerRef.current = null;
      fullscreenTransitioningRef.current = false;
      setIsFullscreenTransitioning(false);
    }, 4_000);

    try {
      await window.electron.setWindowFullscreen(requestedFullscreen);
    } catch (error) {
      if (fullscreenTransitionTimerRef.current !== null) {
        window.clearTimeout(fullscreenTransitionTimerRef.current);
        fullscreenTransitionTimerRef.current = null;
      }
      fullscreenTransitioningRef.current = false;
      setIsFullscreenTransitioning(false);
      console.error('Fullscreen toggle failed:', error);
    }
  };

  const toggleExpanded = useCallback(() => {
    if (!isExpanded && !immersiveControlsVisibleRef.current) {
      immersiveControlsVisibleRef.current = true;
      setAreImmersiveControlsVisible(true);
    }
    setExpandedPresentation(current => ({
      request: collapseRequest,
      expanded: current.request === collapseRequest ? !current.expanded : true
    }));
  }, [collapseRequest, isExpanded]);

  const renderQualitySelector = (mode: 'compact' | 'immersive') => {
    if (!channel.variants || channel.variants.length <= 1) return null;

    const currentQuality = getChannelQualityLabel(channel.name, qualityMappings);

    return (
      <div className={`player-quality-selector player-quality-selector--${mode}`}>
        <button
          onClick={() => setIsQualityOpen(!isQualityOpen)}
          className={`player-ghost-button player-quality-button ${isQualityOpen ? 'is-active' : ''}`}
          title="Choose stream quality"
          aria-haspopup="menu"
          aria-expanded={isQualityOpen}
          aria-label={`Choose stream quality. Current quality: ${currentQuality}`}
        >
          <span className="player-quality-current">{currentQuality}</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M4 7h16" />
            <path d="M7 12h10" />
            <path d="M10 17h4" />
          </svg>
        </button>

        {isQualityOpen && (
          <>
            <div className="player-quality-dismiss" onClick={() => setIsQualityOpen(false)} />
            <div className={`player-quality-popover player-quality-popover--${mode}`} role="menu" aria-label="Stream quality">
              <div className="player-quality-title">
                Quality
              </div>
              {channel.variants.map((variant) => {
                const quality = getChannelQualityLabel(variant.name, qualityMappings);
                const isSelected = variant.id === channel.id;
                return (
                  <button
                    key={variant.id}
                    onClick={() => {
                      setIsQualityOpen(false);
                      onPlayChannel(variant);
                    }}
                    className={`player-quality-option ${isSelected ? 'is-selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={isSelected}
                  >
                    <span>{quality}</span>
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPictureInPicture = () => setIsPictureInPicture(true);
    const handleLeavePictureInPicture = () => {
      setIsPictureInPicture(false);
      void window.electron.focusAppWindow();
    };

    video.addEventListener('enterpictureinpicture', handleEnterPictureInPicture);
    video.addEventListener('leavepictureinpicture', handleLeavePictureInPicture);
    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPictureInPicture);
      video.removeEventListener('leavepictureinpicture', handleLeavePictureInPicture);
    };
  }, []);

  // Commit the renderer change only when macOS has completed its native
  // fullscreen transition. This prevents a competing layout pass mid-animation.
  useEffect(() => {
    const settleFullscreenTransition = (active: boolean) => {
      if (fullscreenTransitionTimerRef.current !== null) {
        window.clearTimeout(fullscreenTransitionTimerRef.current);
        fullscreenTransitionTimerRef.current = null;
      }
      fullscreenTransitioningRef.current = false;
      isFullscreenRef.current = active;
      if (active && !immersiveControlsVisibleRef.current) {
        immersiveControlsVisibleRef.current = true;
        setAreImmersiveControlsVisible(true);
      }
      setIsFullscreenTransitioning(false);
      setIsFullscreen(active);
    };
    const removeListener = window.electron.onWindowFullscreenChange(settleFullscreenTransition);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullscreenRef.current) {
        void window.electron.setWindowFullscreen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      removeListener();
      document.removeEventListener('keydown', handleEscape);
      if (fullscreenTransitionTimerRef.current !== null) {
        window.clearTimeout(fullscreenTransitionTimerRef.current);
      }
    };
  }, []);

  const copyDiagnostics = useCallback(() => {
    const diagnostic = redactPlaybackDiagnostic(JSON.stringify({
      channel: channel.name,
      status: playbackStatus,
      failure: playbackFailure,
      attempts: playbackAttempts,
      createdAtUtc: new Date().toISOString()
    }, null, 2));
    void window.electron.copyText(diagnostic).then(() => showMediaNotice('Playback diagnostics copied.'));
  }, [channel.name, playbackAttempts, playbackFailure, playbackStatus, showMediaNotice]);

  const tryAnotherQuality = useCallback(() => {
    const variants = channel.variants || [];
    if (variants.length < 2) return;
    const currentIndex = variants.findIndex(variant => variant.id === channel.id);
    onPlayChannel(variants[(currentIndex + 1 + variants.length) % variants.length]);
  }, [channel, onPlayChannel]);

  const renderMediaActions = (size: number) => (
    <>
      <button onClick={captureFrame} className="player-ghost-button player-capture-button" title="Take screenshot" aria-label="Take screenshot">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 7h3l2-2h4l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
      <button
        onClick={toggleRecording}
        className={`player-ghost-button player-record-button ${recordingState.status === 'recording' ? 'is-recording' : ''}`}
        title={recordingState.status === 'recording' ? 'Stop recording' : 'Record source as MKV'}
        aria-label={recordingState.status === 'recording' ? 'Stop recording' : 'Start recording'}
      >
        <span className="player-record-dot" />
      </button>
      {(recordingState.status === 'recording' || recordingState.status === 'finalizing') && (
        <span className="player-recording-status" role="status">
          {recordingState.status === 'finalizing' ? 'Finalizing' : formatRecordingDuration(recordingState.startedAtUtc, recordingClock)}
          {' · '}{formatRecordingBytes(recordingState.bytes)}
        </span>
      )}
    </>
  );

  const networkHistoryPeak = Math.max(1, ...stats.networkHistory);

  return (
    <div 
      id="player-container"
      className={`player-shell ${isImmersive ? 'player-shell--immersive' : 'player-shell--compact'} ${isExpanded ? 'player-shell--expanded' : ''} ${isFullscreen ? 'player-shell--fullscreen' : ''} ${isImmersive && !areImmersiveControlsVisible ? 'player-shell--controls-hidden' : ''} ${isCapturing ? 'player-shell--capturing' : ''}`}
      onMouseMove={isImmersive ? revealImmersiveControls : undefined}
      onPointerDown={isImmersive ? revealImmersiveControls : undefined}
      onTouchStart={isImmersive ? revealImmersiveControls : undefined}
      onFocusCapture={isImmersive ? revealImmersiveControls : undefined}
    >
      {/* Video element (Always rendered to avoid unmounting, styled relative to the player state) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        preload="auto"
        className={`player-video ${isImmersive ? 'player-video--immersive' : 'player-video--compact'}`}
        tabIndex={0}
        aria-label={`${channel.name} live video`}
        onClick={isImmersive ? revealImmersiveControls : toggleExpanded}
        onKeyDown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return;
          event.preventDefault();
          if (isImmersive) revealImmersiveControls();
          else toggleExpanded();
        }}
      />

      {/* Video Placeholder in flex flow (only in compact mode to reserve space for absolute video element) */}
      {!isImmersive && (
        <button
          type="button"
          className="player-preview-spacer"
          onClick={toggleExpanded}
          title="Expand player inside app"
          aria-label={`Expand ${channel.name} player`}
        />
      )}

      {/* Buffering/Loading Indicator Overlay */}
      {isBuffering && (
        <div 
          className={`player-loading ${isImmersive ? 'player-loading--immersive' : 'player-loading--compact'}`}
          role="status"
          aria-live="polite"
        >
          <svg className="animate-spin" width={isImmersive ? "28" : "22"} height={isImmersive ? "28" : "22"} viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="3.5" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)"/>
            <path d="M4 12a8 8 0 0 1 8-8" />
          </svg>
          {isImmersive && (
            <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
              {bufferingText}
            </span>
          )}
        </div>
      )}

      {/* Playback Stats Panel Overlay */}
      {showStats && isImmersive && (
        <div 
          className={`player-stats-panel ${!isImmersive ? 'player-stats-panel--compact' : ''}`}
          role="region"
          aria-label="Playback statistics"
        >
          <div className="player-stats-header">
            <span>PLAYBACK STATISTICS</span>
            <button onClick={() => setShowStats(false)} aria-label="Close playback statistics">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="player-stats-details">
            <span>Viewport / Frames</span><strong>{stats.resolution} · {stats.fps} · {stats.droppedFrames} dropped</strong>
            <span>Current bitrate</span><strong>{stats.inputBitrate}</strong>
            <span>Codecs</span><strong>{stats.videoCodec} / {stats.audioCodec}</strong>
            <span>Transferred</span><strong>{stats.readBytes}</strong>
          </div>

          <div className="player-stats-live-metrics">
            <div className="player-stats-meter-row">
              <span>Connection speed</span>
              <div className="player-stats-speed-track" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (stats.connectionSpeedKbps / 25000) * 100)}%` }} />
              </div>
              <strong>{stats.connectionSpeed}</strong>
            </div>
            <div className="player-stats-meter-row">
              <span>Network activity</span>
              <div className="player-network-chart" aria-label={`Network activity: ${stats.networkActivity}`}>
                {stats.networkHistory.map((sample, index) => (
                  <i key={`${index}-${sample}`} style={{ height: `${Math.max(3, (sample / networkHistoryPeak) * 100)}%` }} />
                ))}
              </div>
              <strong>{stats.networkActivity}</strong>
            </div>
            <div className="player-stats-meter-row">
              <span>Buffer health</span>
              <div className="player-buffer-health" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (stats.bufferHealth / 30) * 100)}%` }} />
              </div>
              <strong>{stats.bufferHealth.toFixed(1)} s</strong>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Controls Overlay Bar - Redesigned as macOS Floating HUD Dock */}
      {isImmersive && (
        <div className={`hud-controls-shell ${areImmersiveControlsVisible ? 'hud-controls-shell--visible' : 'hud-controls-shell--hidden'}`}>
          <div className="hud-glass-layer" aria-hidden="true" />

          <div className="hud-controls-inner">
          {/* Left Section: Active Channel Details */}
          <div className="hud-channel">
            <span className="hud-kicker">NOW PLAYING</span>
            <div className="hud-title-row">
              <h4 className="hud-title">
                {channel.name}
              </h4>
              {renderQualitySelector('immersive')}
            </div>
          </div>

          {/* Center Section: Core Media Buttons */}
          <div className="hud-transport">
            <button
              onClick={onPrevChannel}
              className="player-circle-button"
              title="Previous channel"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="19 20 9 12 19 4 19 20" />
                <line x1="5" y1="19" x2="5" y2="5" />
              </svg>
            </button>

            <button
              onClick={onStop}
              className="player-stop-button"
              title="Stop playback"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>

            <button
              onClick={onNextChannel}
              className="player-circle-button"
              title="Next channel"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
            </button>

          </div>

          {/* Right Section: Volume & Fullscreen / PIP / HUD Controls */}
          <div className="hud-utilities">
            <div className="player-volume">
              <button onClick={handleMuteToggle} className="player-ghost-button" title={volume === 0 ? 'Unmute' : 'Mute'}>
                {volume === 0 ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                aria-label="Playback volume"
                onChange={(e) => onVolumeChange(parseInt(e.target.value))}
                className="player-range player-range--wide"
                style={{ '--range-fill': `${volume}%` } as React.CSSProperties}
              />
            </div>

            {renderMediaActions(15)}

            <button onClick={() => setShowStats(!showStats)} className={`player-ghost-button ${showStats ? 'is-active' : ''}`} title="Playback statistics">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </button>

            <button onClick={handlePipToggle} className="player-ghost-button" title="Picture-in-Picture">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <rect x="13" y="11" width="7" height="7" rx="1" />
              </svg>
            </button>

            <button onClick={handleFullscreenToggle} className="player-ghost-button" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} disabled={isFullscreenTransitioning} aria-busy={isFullscreenTransitioning}>
              {isFullscreen ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>

            <button onClick={toggleExpanded} className="player-ghost-button" title="Collapse player">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Compact Mode Layout next to Video Canvas */}
      {!isImmersive && (
        <>
          {/* Details Column */}
          <div className="compact-details">
            <div className="compact-title-row">
              <span className="compact-channel">
                {channel.name}
              </span>
              {renderQualitySelector('compact')}
              <span className="compact-separator">|</span>
              <span className="compact-program">
                {currentProgram ? currentProgram.title : 'No guide programme'}
              </span>
            </div>

            {currentProgram && (
              <div className="compact-progress-row">
                <div className="player-progress">
                  <div className="player-progress-fill" style={{ width: `${currentProgress}%` }} />
                </div>
                <span className="compact-time">
                  {formatTime(currentProgram.startUtc)} - {formatTime(currentProgram.stopUtc)}
                </span>
              </div>
            )}

            <div className={`compact-state ${isPlaying ? 'compact-state--connected' : ''}`}>
              {compactPlaybackStateText({ isPlaying, bufferingText })}
            </div>
          </div>

          {/* Compact Controls Column */}
          <div className="compact-controls">
            {/* Prev Channel */}
            <button 
              onClick={onPrevChannel}
              className="player-circle-button player-circle-button--compact"
              title="Previous channel"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="19 20 9 12 19 4 19 20" />
                <line x1="5" y1="19" x2="5" y2="5" />
              </svg>
            </button>

            {/* Stop Playback */}
            <button 
              onClick={onStop}
              className="player-stop-button player-stop-button--compact"
              title="Stop playback"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            </button>

            {/* Next Channel */}
            <button 
              onClick={onNextChannel}
              className="player-circle-button player-circle-button--compact"
              title="Next channel"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
            </button>

            <div className="player-divider" />

            {/* Volume Control */}
            <div className="player-volume">
              <button 
                onClick={handleMuteToggle}
                className="player-ghost-button"
                title={volume === 0 ? 'Unmute' : 'Mute'}
              >
                {volume === 0 ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
              <input 
                type="range"
                min="0"
                max="100"
                value={volume}
                aria-label="Playback volume"
                onChange={(e) => onVolumeChange(parseInt(e.target.value))}
                className="player-range player-range--compact"
                style={{ '--range-fill': `${volume}%` } as React.CSSProperties}
              />
            </div>

            {/* PIP Toggle */}
            <button 
              onClick={handlePipToggle}
              className="player-ghost-button"
              title="Picture-in-Picture"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <rect x="13" y="11" width="7" height="7" rx="1" />
              </svg>
            </button>

            {/* Fullscreen Toggle */}
            <button 
              onClick={handleFullscreenToggle}
              className="player-ghost-button"
              title="Fullscreen"
              disabled={isFullscreenTransitioning}
              aria-busy={isFullscreenTransitioning}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>

            {/* Expand Toggle */}
            <button 
              onClick={toggleExpanded}
              className="player-ghost-button"
              title="Expand Player"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          </div>
        </>
      )}

      {playbackFailure && (
        <div className="player-error-panel" role="alert">
          <strong>{playbackFailure.message}</strong>
          <span>{playbackAttempts.length} playback engines tried.</span>
          <div>
            <button type="button" onClick={() => setRetryNonce(value => value + 1)}>Retry</button>
            {(channel.variants?.length || 0) > 1 && <button type="button" onClick={tryAnotherQuality}>Try another quality</button>}
            <button type="button" onClick={copyDiagnostics}>Copy diagnostics</button>
            <button type="button" onClick={onNextChannel}>Next channel</button>
          </div>
        </div>
      )}

      {mediaNotice && <div className="player-media-notice" role="status" aria-live="polite">{mediaNotice}</div>}

      {isPictureInPicture && (
        <div className={`pip-return-prompt ${isImmersive ? 'pip-return-prompt--immersive' : 'pip-return-prompt--compact'}`} role="status" aria-live="polite">
          <button
            type="button"
            className={`pip-return-button ${isImmersive ? '' : 'pip-return-button--compact'}`}
            onClick={handlePipToggle}
            title="Return broadcast to app"
          >
            <svg aria-hidden="true" width={isImmersive ? "18" : "14"} height={isImmersive ? "18" : "14"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
              <path d="M14 5h7v7" />
              <path d="m21 5-9 9" />
            </svg>
            {isImmersive ? 'Return broadcast to app' : 'Return'}
          </button>
        </div>
      )}
    </div>
  );
};
