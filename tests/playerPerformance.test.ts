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

test('does not animate decoded video geometry or blur the fullscreen HUD', () => {
  const css = readProjectFile('src/index.css');
  const videoRule = css.match(/\.player-video\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const finalHudRule = css.slice(css.lastIndexOf('.hud-glass-layer {'));

  assert.match(videoRule, /transition:\s*none/);
  assert.doesNotMatch(videoRule, /transition:\s*all/);
  assert.match(css, /\.player-video--immersive[\s\S]*image-rendering:\s*auto/);
  assert.doesNotMatch(css, /\.player-video--immersive[\s\S]*image-rendering:\s*high-quality/);
  assert.match(finalHudRule, /backdrop-filter:\s*none/);
  assert.match(finalHudRule, /-webkit-backdrop-filter:\s*none/);
});

test('does not fight the decoder with gap seeks during startup or display changes', () => {
  const playerSource = readProjectFile('src/components/VideoPlayer.tsx');
  const mainSource = readProjectFile('main.cjs');

  assert.match(playerSource, /!hasStartedPlayback \|\| video\.readyState < HTMLMediaElement\.HAVE_CURRENT_DATA/);
  assert.match(playerSource, /video\.currentTime !== prevTime && video\.paused/);
  assert.match(playerSource, /\}, 1000\);/);
  assert.match(mainSource, /backgroundThrottling:\s*process\.platform !== 'darwin'/);
});
