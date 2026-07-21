import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

test('keeps player presentation state local and settles fullscreen from the native event', () => {
  const appSource = readProjectFile('src/App.tsx');
  const playerSource = readProjectFile('src/components/VideoPlayer.tsx');

  assert.doesNotMatch(appSource, /isPlayerExpanded/);
  assert.match(playerSource, /collapseRequest: number/);
  assert.match(playerSource, /onWindowFullscreenChange\(settleFullscreenTransition\)/);
  assert.doesNotMatch(playerSource, /setIsFullscreen\(active\);\s*}\s*catch/);
  assert.match(playerSource, /statsTickInFlightRef/);
});

test('keeps decoded video geometry stable with a refractive HUD fallback', () => {
  const css = readProjectFile('src/index.css');
  const videoRule = css.match(/\.player-video\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const finalHudRule = css.slice(css.lastIndexOf('.hud-glass-layer {'));

  assert.match(videoRule, /transition:\s*none/);
  assert.doesNotMatch(videoRule, /transition:\s*all/);
  assert.match(css, /\.player-video--immersive[\s\S]*image-rendering:\s*auto/);
  assert.doesNotMatch(css, /\.player-video--immersive[\s\S]*image-rendering:\s*high-quality/);
  assert.match(finalHudRule, /backdrop-filter:\s*none/);
  assert.match(finalHudRule, /-webkit-backdrop-filter:\s*none/);
  assert.match(
    css,
    /@supports\s*\(backdrop-filter:\s*url\("#liquid-glass-refraction"\)\)[\s\S]*\.hud-glass-layer,[\s\S]*backdrop-filter:\s*url\("#liquid-glass-refraction"\)/
  );
});

test('does not fight the decoder with gap seeks during startup or display changes', () => {
  const playerSource = readProjectFile('src/components/VideoPlayer.tsx');
  const mainSource = readProjectFile('main.cjs');

  assert.match(playerSource, /!hasStartedPlayback \|\| video\.readyState < HTMLMediaElement\.HAVE_CURRENT_DATA/);
  assert.match(playerSource, /video\.currentTime !== prevTime && video\.paused/);
  assert.match(playerSource, /\}, 1000\);/);
  assert.match(mainSource, /backgroundThrottling:\s*process\.platform !== 'darwin'/);
});

test('keeps full history rewrites and analytics out of the zapping path', () => {
  const appSource = readProjectFile('src/App.tsx');
  const preloadSource = readProjectFile('preload.cjs');
  const mainSource = readProjectFile('main.cjs');
  const endSessionStart = appSource.indexOf('const endCurrentSession = useCallback');
  const endSessionEnd = appSource.indexOf('useEffect(() => {\n    endCurrentSessionRef.current', endSessionStart);
  const endSessionSource = appSource.slice(endSessionStart, endSessionEnd);

  assert.match(preloadSource, /appendHistory:\s*\(session\)\s*=>\s*ipcRenderer\.invoke\('append-history', session\)/);
  assert.match(mainSource, /registerTrustedHandle\('append-history'/);
  assert.match(endSessionSource, /window\.electron\.appendHistory\(completedSession\)/);
  assert.doesNotMatch(endSessionSource, /computeStats\(/);
});

test('keeps the active channel update urgent while history review data is deferred', () => {
  const appSource = readProjectFile('src/App.tsx');
  const endSessionStart = appSource.indexOf('const endCurrentSession = useCallback');
  const endSessionEnd = appSource.indexOf('useEffect(() => {\n    endCurrentSessionRef.current', endSessionStart);
  const endSessionSource = appSource.slice(endSessionStart, endSessionEnd);
  const playChannelStart = appSource.indexOf('const playChannel = useCallback');
  const playChannelEnd = appSource.indexOf('\n  useEffect(() => window.electron.onReminderNotification', playChannelStart);
  const playChannelSource = appSource.slice(playChannelStart, playChannelEnd);

  assert.match(endSessionSource, /startTransition\(\(\) => setWatchHistory\(updatedHistory\)\)/);
  assert.match(playChannelSource, /const previousSessionSave = endCurrentSessionRef\.current\(\);/);
  assert.ok(
    playChannelSource.indexOf('setActiveChannel(playbackChannel)') < playChannelSource.indexOf('await previousSessionSave'),
    'The active channel should be updated before waiting for history persistence.'
  );
});

test('does not invalidate every inactive channel card when the active channel changes', () => {
  const cardSource = readProjectFile('src/components/ChannelCard.tsx');

  assert.match(cardSource, /!nextProps\.isActive\s*\|\|\s*prevProps\.activeChannelId\s*===\s*nextProps\.activeChannelId/);
  assert.doesNotMatch(cardSource, /&&\s*prevProps\.activeChannelId\s*===\s*nextProps\.activeChannelId\s*&&/);
});

test('passes one stable reminder callback to memoized TV guide rows', () => {
  const appSource = readProjectFile('src/App.tsx');
  const guideSource = readProjectFile('src/components/TvGuideTab.tsx');

  assert.match(appSource, /const handleToggleReminder = useCallback\(/);
  assert.match(guideSource, /const handleRowToggleReminder = useCallback\(/);
  assert.match(guideSource, /onToggleReminder=\{handleRowToggleReminder\}/);
  assert.doesNotMatch(guideSource, /onToggleReminder=\{\(channel, programme\) =>/);
});

test('skips the full Live TV filter scan when no filters are active', () => {
  const gridSource = readProjectFile('src/components/LiveGrid.tsx');

  assert.match(gridSource, /if \(!showFavoritesOnly && effectiveSelectedCategory === 'All channels' && !hasSearch && !nowOnly && startingSoonMinutes === 0\) \{\s*return channels;\s*\}/);
});

test('indexes favorites before rebuilding refreshed playlist rows', () => {
  const appSource = readProjectFile('src/App.tsx');
  const refreshStart = appSource.indexOf('const refreshSourcesInternal = useCallback');
  const refreshEnd = appSource.indexOf('\n  useEffect(() => {\n    refreshSourcesInternalRef.current', refreshStart);
  const refreshSource = appSource.slice(refreshStart, refreshEnd);

  assert.match(refreshSource, /const favoriteIds = new Set\(favorites\);/);
  assert.match(refreshSource, /isFavorite: favoriteIds\.has\(ch\.id\)/);
  assert.doesNotMatch(refreshSource, /isFavorite: favorites\.includes\(ch\.id\)/);
});
