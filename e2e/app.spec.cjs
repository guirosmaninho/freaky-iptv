const { test, expect, _electron: electron } = require('playwright/test');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

test.describe.configure({ mode: 'serial' });

let electronApp;
let page;
let fixtureRoot;
let mediaDirectory;
let server;
let baseUrl;

async function compareVisualSnapshot(name, options = {}) {
  const baseline = path.join(__dirname, 'snapshots', name);
  if (process.env.FREAKYIPTV_VISUAL_SNAPSHOTS === '1' || fs.existsSync(baseline)) {
    await expect(page).toHaveScreenshot(name, options);
  }
}

function startFixtureServer(videoPath) {
  return new Promise((resolve) => {
    const instance = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://fixture.local').pathname;
      if (pathname === '/stream.mp4') {
        const stat = fs.statSync(videoPath);
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        response.writeHead(range ? 206 : 200, {
          'Content-Type': 'video/mp4',
          'Content-Length': end - start + 1,
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        });
        const stream = fs.createReadStream(videoPath, { start, end, highWaterMark: 64 * 1024 });
        if (String(request.headers['user-agent'] || '').startsWith('VLC/')) {
          stream.on('data', chunk => {
            stream.pause();
            response.write(chunk, () => setTimeout(() => stream.resume(), 50));
          });
          stream.on('end', () => response.end());
          stream.on('error', () => response.destroy());
        } else {
          stream.pipe(response);
        }
        return;
      }
      if (pathname === '/unauthorized') {
        response.writeHead(401).end('Unauthorized');
        return;
      }
      if (pathname === '/missing') {
        response.writeHead(404).end('Not found');
        return;
      }
      if (pathname === '/timeout') return;
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('fixture');
    });
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });
}

async function seedApplication() {
  const playlistUrl = `${baseUrl}/playlist.m3u`;
  const hash = createHash('sha256').update(playlistUrl).digest('hex').slice(0, 16);
  const channels = ['News One', 'Sport Two', 'Cinema Three'].map((name, index) => ({
    id: `fixture-${index + 1}`,
    tvgId: `fixture-${index + 1}`,
    name,
    logoUrl: '',
    groupTitle: index === 1 ? 'Sports' : 'General',
    streamUrl: `${baseUrl}/stream.mp4?channel=${index + 1}`,
    duration: -1,
    attributes: {}
  }));
  const settings = {
    playlistUrl,
    epgUrl: '',
    lastPlayedChannelId: '',
    favoriteChannelIds: ['fixture-2'],
    recentlyViewedChannelIds: [],
    volume: 55,
    qualityMappings: {},
    autoRefreshHours: 4,
    autoplayLastChannel: false,
    historyRetentionDays: 30,
    discordRpcEnabled: false,
    discordShowChannel: false,
    discordClientId: '',
    appearance: 'dark',
    recordingDirectory: mediaDirectory,
    recordingMode: 'source-mkv'
  };
  const cache = {
    schemaVersion: 1,
    playlistUrlHash: hash,
    epgUrlHash: '',
    parserVersion: 'react-ts-v1',
    savedAtUtc: new Date().toISOString(),
    channels,
    programs: [],
    epgChannelDisplayNames: {},
    epgNormalizedNameMap: {}
  };
  await page.evaluate(async ({ settings: nextSettings, cache: nextCache }) => {
    await window.electron.saveSettings(nextSettings);
    await window.electron.saveCache(nextCache);
  }, { settings, cache });
  await page.reload();
  await expect(page.locator('.home-greeting-hero')).toBeVisible();
}

test.beforeAll(async () => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freakyiptv-e2e-'));
  mediaDirectory = path.join(fixtureRoot, 'recordings');
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const videoPath = path.join(fixtureRoot, 'stream.mp4');
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', videoPath
  ]);
  server = await startFixtureServer(videoPath);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  electronApp = await electron.launch({
    args: ['.', '--disable-gpu'],
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      FREAKYIPTV_E2E: '1',
      FREAKYIPTV_DATA_DIR: path.join(fixtureRoot, 'data'),
      FREAKYIPTV_RECORDINGS_DIR: mediaDirectory,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  });
  page = electronApp.windows()[0] || await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await seedApplication();
});

test.afterAll(async () => {
  try {
    await electronApp?.evaluate(({ app }) => app.quit());
    await electronApp?.close();
  } finally {
    await new Promise((resolve) => server?.close(resolve));
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('renders the main screens at supported window sizes', async () => {
  const greetingHero = page.locator('.home-greeting-hero');
  await expect(greetingHero).toBeVisible();
  await expect(greetingHero.getByRole('heading')).toBeVisible();
  await expect(greetingHero.getByRole('button')).toBeVisible();
  const greetingLogo = greetingHero.getByRole('img', { name: 'Freaky IPTV' });
  await expect(greetingLogo).toBeVisible();
  await expect.poll(() => greetingLogo.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(greetingHero.getByText('Freaky IPTV', { exact: true })).toBeVisible();
  const greetingId = await greetingHero.getAttribute('data-greeting-id');
  expect(greetingId).toBeTruthy();

  for (const [width, height] of [[1024, 600], [1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await compareVisualSnapshot(`home-${width}x${height}.png`, { animations: 'disabled' });
  }

  for (const [width, height] of [[760, 420], [900, 500], [1365, 520], [2560, 640]]) {
    await page.setViewportSize({ width, height });
    const layout = await greetingHero.evaluate((hero) => {
      const heroRect = hero.getBoundingClientRect();
      const content = Array.from(hero.querySelectorAll('[data-greeting-content]'));
      return {
        horizontalOverflow: hero.scrollWidth > hero.clientWidth + 1,
        verticalOverflow: hero.scrollHeight > hero.clientHeight + 1,
        contentOutside: content.some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < heroRect.left - 1 || rect.right > heroRect.right + 1 ||
            rect.top < heroRect.top - 1 || rect.bottom > heroRect.bottom + 1;
        })
      };
    });
    expect(layout, `Greeting layout at ${width}x${height}`).toEqual({
      horizontalOverflow: false,
      verticalOverflow: false,
      contentOutside: false
    });
  }

  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Live TV' })).toBeVisible();
  await compareVisualSnapshot('live-tv-1920x1080.png', { animations: 'disabled' });

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-greeting-hero')).toHaveAttribute('data-greeting-id', greetingId);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();
  const playlistField = page.getByLabel('M3U playlist URL');
  const epgField = page.getByLabel('XMLTV EPG URL (optional)');
  await expect(playlistField).toHaveAttribute('type', 'password');
  await expect(epgField).toHaveAttribute('type', 'password');
  await page.locator('.settings-secret-field').first().getByRole('button', { name: 'Show' }).click();
  await expect(playlistField).toHaveAttribute('type', 'url');
  await playlistField.focus();
  await playlistField.blur();
  await expect(playlistField).toHaveAttribute('type', 'password');
  await compareVisualSnapshot('settings-1920x1080.png', { animations: 'disabled', fullPage: true });

  await page.getByLabel('Refresh sources every (hours)').fill('6');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Discard unsaved settings changes');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 2 })).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.home-greeting-hero')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('cannot be undone');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Clear cache' }).click();
});

test('checks for updates only after an explicit About action', async () => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Atualizações' })).toBeVisible();
  const versionRow = page.locator('.about-info-row').filter({ hasText: 'App Version' });
  const updateButton = versionRow.getByRole('button', { name: 'Procurar atualizações', exact: true });
  await expect(page.locator('.about-updates').getByRole('button', { name: 'Procurar atualizações', exact: true })).toHaveCount(0);
  const versionControlLayout = await versionRow.evaluate((row) => {
    const versionBadge = row.querySelector('.version-badge')?.getBoundingClientRect();
    const button = row.querySelector('button')?.getBoundingClientRect();
    return { versionBottom: versionBadge?.bottom, buttonTop: button?.top, buttonHeight: button?.height };
  });
  expect(versionControlLayout.buttonTop).toBeGreaterThanOrEqual(versionControlLayout.versionBottom - 1);
  expect(versionControlLayout.buttonHeight).toBeLessThanOrEqual(28);
  await expect(updateButton).toBeEnabled();
  await updateButton.click();
  await expect(page.getByRole('status')).toContainText('aplicacao empacotada');
  await expect(updateButton).toHaveAccessibleName('Procurar atualizações');
});
test('zaps with arrow keys, wraps channels, and preserves full app mode', async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await page.getByRole('button', { name: 'Play News One' }).click();
  await expect(page.locator('.player-shell')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start recording' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Take screenshot' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Playback statistics' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /last channel/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^play$/i })).toHaveCount(0);
  await compareVisualSnapshot('player-compact-1920x1080.png', { animations: 'disabled' });

  const compactGlass = await page.locator('.player-shell--compact').evaluate((element) => {
    const style = getComputedStyle(element);
    const alpha = Number(style.backgroundColor.match(/rgba?\([^,]+,\s*[^,]+,\s*[^,]+(?:,\s*([\d.]+))?\)/)?.[1] ?? 1);
    return { alpha, backdropFilter: style.backdropFilter };
  });
  expect(compactGlass.alpha).toBeLessThanOrEqual(0.1);
  expect(compactGlass.backdropFilter).toBe('none');

  await page.getByRole('button', { name: /Expand News One player/ }).click();
  await expect(page.locator('.player-shell')).toHaveClass(/player-shell--expanded/);
  await compareVisualSnapshot('player-full-app-controls-visible-1920x1080.png', { animations: 'disabled' });

  const hudGlass = await page.locator('.hud-glass-layer').evaluate((element) => {
    const style = getComputedStyle(element);
    const alpha = Number(style.backgroundColor.match(/rgba?\([^,]+,\s*[^,]+,\s*[^,]+(?:,\s*([\d.]+))?\)/)?.[1] ?? 1);
    return { alpha, backdropFilter: style.backdropFilter };
  });
  expect(hudGlass.alpha).toBeLessThanOrEqual(0.1);
  expect(hudGlass.backdropFilter).toBe('none');

  for (const viewportWidth of [1920, 1500, 1366, 1280, 1200, 1024]) {
    await page.setViewportSize({ width: viewportWidth, height: 720 });
    await page.mouse.move(viewportWidth / 2, 360);
    await expect(page.locator('.hud-controls-shell')).toHaveClass(/hud-controls-shell--visible/);

    const layoutErrors = await page.locator('.hud-controls-inner').evaluate((hud) => {
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const intersects = (a, b) => (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      );
      const describe = (element) => element.getAttribute('title') || element.getAttribute('aria-label') || element.className || element.tagName;
      const errors = [];
      const groups = [...hud.querySelectorAll('.hud-channel, .hud-transport, .hud-utilities')].filter(isVisible);
      const controls = [...hud.querySelectorAll('button, input')].filter(isVisible);

      const groupCenters = groups.map((group) => {
        const rect = group.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      if (Math.max(...groupCenters) - Math.min(...groupCenters) > 1) {
        errors.push('HUD groups are split across multiple rows');
      }
      if (hud.getBoundingClientRect().height > 120) {
        errors.push('HUD is taller than a single control row');
      }

      for (let left = 0; left < groups.length; left += 1) {
        for (let right = left + 1; right < groups.length; right += 1) {
          if (intersects(groups[left].getBoundingClientRect(), groups[right].getBoundingClientRect())) {
            errors.push(`${describe(groups[left])} overlaps ${describe(groups[right])}`);
          }
        }
      }
      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          if (intersects(controls[left].getBoundingClientRect(), controls[right].getBoundingClientRect())) {
            errors.push(`${describe(controls[left])} overlaps ${describe(controls[right])}`);
          }
        }
      }
      return errors;
    });
    expect(layoutErrors, `HUD layout at ${viewportWidth}px`).toEqual([]);
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.mouse.move(960, 540);

  const stopAlignment = await page.locator('.hud-controls-inner').evaluate((hud) => {
    const stop = hud.querySelector('.player-stop-button');
    const hudRect = hud.getBoundingClientRect();
    const stopRect = stop.getBoundingClientRect();
    return Math.abs((stopRect.left + stopRect.width / 2) - (hudRect.left + hudRect.width / 2));
  });
  expect(stopAlignment).toBeLessThanOrEqual(1);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.zap-overlay')).toContainText('Sport Two');
  await expect(page.locator('.player-shell')).toHaveClass(/player-shell--expanded/);

  const slider = page.getByRole('slider', { name: 'Playback volume' });
  const before = Number(await slider.inputValue());
  await page.keyboard.press('ArrowUp');
  await expect(slider).toHaveValue(String(Math.min(100, before + 5)));
  await page.mouse.move(10, 10);
  await expect(page.locator('.player-shell')).toHaveClass(/player-shell--controls-hidden/, { timeout: 5000 });
  await compareVisualSnapshot('player-full-app-controls-hidden-1920x1080.png', { animations: 'disabled' });
  await page.mouse.move(960, 540);
});

test('enters native fullscreen and returns without losing playback', async () => {
  await page.locator('button[title="Fullscreen"]').click();
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
  await page.mouse.move(10, 10);
  await expect(page.locator('.player-shell')).toHaveClass(/player-shell--controls-hidden/, { timeout: 5000 });
  await expect(page.locator('.player-video--immersive')).toHaveCSS('cursor', 'none');
  await page.mouse.move(640, 360);
  await expect(page.locator('.player-shell')).not.toHaveClass(/player-shell--controls-hidden/);
  await expect(page.locator('.player-video--immersive')).toHaveCSS('cursor', 'default');
  await page.locator('button[title="Exit fullscreen"]').click();
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
  await expect(page.locator('.player-shell')).toBeVisible();
});

test('stopping playback exits native fullscreen before removing the player', async () => {
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await page.getByRole('button', { name: 'Play News One' }).click();
  await expect(page.locator('.player-shell')).toBeVisible();
  await page.getByRole('button', { name: /Expand News One player/ }).click();
  await expect(page.locator('.player-shell')).toHaveClass(/player-shell--expanded/);

  await page.locator('button[title="Fullscreen"]').click();
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);

  await page.locator('button[title="Stop playback"]').click();

  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
  await expect(page.locator('.player-shell')).toHaveCount(0);
});

test('captures the video frame to disk and clipboard', async () => {
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await page.getByRole('button', { name: 'Play News One' }).click();
  await expect(page.locator('.player-shell')).toBeVisible();
  await page.getByRole('button', { name: /Expand News One player/ }).click();
  await expect(page.locator('.player-shell')).toHaveClass(/player-shell--expanded/);

  await page.getByRole('button', { name: 'Take screenshot' }).click();
  await expect(page.locator('.player-media-notice')).toContainText('Screenshot');
  await expect.poll(() => fs.readdirSync(mediaDirectory).filter((name) => name.endsWith('.png')).length).toBe(1);
  const clipboardSize = await electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize());
  expect(clipboardSize).toEqual({ width: 640, height: 360 });
});

test('does not pause live playback when the video is clicked or activated from the keyboard', async () => {
  const video = page.locator('video');
  const beforeClick = await video.evaluate(element => element.currentTime);
  await video.click({ position: { x: 80, y: 80 } });
  await page.waitForTimeout(500);
  const afterClick = await video.evaluate(element => element.currentTime);
  expect(afterClick).toBeGreaterThan(beforeClick);

  await video.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const afterKeyboard = await video.evaluate(element => element.currentTime);
  expect(afterKeyboard).toBeGreaterThan(afterClick);
});

test('records and gracefully finalizes a source MKV', async () => {
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await compareVisualSnapshot('player-recording-active-1920x1080.png', { animations: 'disabled' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible({ timeout: 8000 });
  await expect.poll(() => fs.readdirSync(mediaDirectory).filter((name) => name.endsWith('.mkv')).length).toBe(1);
  const file = fs.readdirSync(mediaDirectory).find((name) => name.endsWith('.mkv'));
  const output = path.join(mediaDirectory, file);
  expect(fs.statSync(output).size).toBeGreaterThan(1024);
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
});

test('creates a fixed-size statistics card and copies it to the clipboard', async () => {
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await page.getByRole('button', { name: 'Share statistics' }).click();
  await expect(page.getByRole('dialog', { name: 'Share viewing statistics' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy image' }).click();
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readImage().getSize())).toEqual({ width: 1200, height: 736 });
});

test('presents overlapping seasonal reviews in priority order', async () => {
  await page.clock.install({ time: new Date('2023-01-01T09:00:00.000Z') });
  const reviewHistory = [
    {
      sessionId: 'annual-session',
      channelId: 'fixture-1',
      canonicalChannelId: 'fixture-1',
      channelName: 'News One Full HD',
      baseChannelName: 'News One',
      channelGroup: 'General',
      startTimeUtc: '2022-12-10T20:00:00.000Z',
      endTimeUtc: '2022-12-10T22:00:00.000Z',
      playingDurationMs: 7_200_000,
      bytesConsumed: 536_870_912,
      bytesSource: 'network',
      qualityLabel: 'FHD',
      streamMode: 'copy'
    },
    {
      sessionId: 'monthly-session',
      channelId: 'fixture-2',
      canonicalChannelId: 'fixture-2',
      channelName: 'Sport Two HD',
      baseChannelName: 'Sport Two',
      channelGroup: 'Sports',
      startTimeUtc: '2022-12-15T19:00:00.000Z',
      endTimeUtc: '2022-12-15T20:00:00.000Z',
      playingDurationMs: 3_600_000,
      bytesConsumed: 0,
      qualityLabel: 'HD',
      streamMode: 'hardware'
    },
    {
      sessionId: 'weekly-session',
      channelId: 'fixture-1',
      canonicalChannelId: 'fixture-1',
      channelName: 'News One Full HD',
      baseChannelName: 'News One',
      channelGroup: 'General',
      startTimeUtc: '2022-12-19T20:00:00.000Z',
      endTimeUtc: '2022-12-19T21:00:00.000Z',
      playingDurationMs: 3_600_000,
      bytesConsumed: 0,
      qualityLabel: 'FHD',
      streamMode: 'copy'
    }
  ];

  await page.evaluate(async (history) => {
    const settings = await window.electron.loadSettings();
    await window.electron.saveSettings({ ...settings, historyRetentionDays: 3650, openedReviewIds: [], dismissedReviewIds: [] });
    await window.electron.saveHistory(history);
  }, reviewHistory);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  for (const [width, height] of [[1024, 600], [1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await compareVisualSnapshot(`review-banner-${width}x${height}.png`, { animations: 'disabled' });
  }

  await expect(page.getByRole('button', { name: 'Year Review', exact: true })).toHaveClass(/sidebar-year-review--highlighted/);
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await page.getByRole('button', { name: 'Play News One' }).click();
  await expect(page.locator('.player-shell--compact')).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: /Open Year Review/ }).click();
  await expect(page.locator('.annual-review')).toHaveAttribute('aria-label', '2022 Year Review');
  await expect(page.getByRole('button', { name: 'Year Review', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Year Review', exact: true })).toHaveClass(/sidebar-year-review--highlighted/);
  const layout = await page.locator('.annual-review-footer, .player-shell--compact').evaluateAll((elements) =>
    elements.map(element => {
      const { top, bottom } = element.getBoundingClientRect();
      return { top, bottom };
    })
  );
  expect(layout).toHaveLength(2);
  expect(layout[0].bottom).toBeLessThanOrEqual(layout[1].top);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.annual-review-progress')).toHaveAttribute('aria-label', /Chapter 2/);
  await compareVisualSnapshot('annual-review-1920x1080.png', { animations: 'disabled' });

  const savedSettings = await page.evaluate(() => window.electron.loadSettings());
  expect(savedSettings.openedReviewIds).toContain('annual:2022');

  await page.getByRole('button', { name: 'Exit Year Review' }).click();
  await expect(page.locator('.review-banner')).toHaveClass(/review-banner--opened/);
  await expect(page.locator('.review-banner')).not.toHaveClass(/review-banner--pending/);
  await page.getByRole('button', { name: /Dismiss Year Review/ }).click();
  await page.getByRole('button', { name: /Open Monthly Review/ }).click();
  await expect(page.getByRole('heading', { name: 'Statistics', level: 2 })).toBeVisible();

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.review-banner')).toHaveClass(/review-banner--opened/);
  await page.getByRole('button', { name: /Dismiss Monthly Review/ }).click();
  await page.getByRole('button', { name: /Open Weekly Review/ }).click();
  await expect(page.getByRole('heading', { name: 'Statistics', level: 2 })).toBeVisible();

  const dismissedSettings = await page.evaluate(() => window.electron.loadSettings());
  expect(dismissedSettings.dismissedReviewIds).toEqual(expect.arrayContaining(['annual:2022', 'monthly:2022-12']));
});
