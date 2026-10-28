const { closeTestApp } = require('./closeTestApp.cjs');
const { test, expect, _electron: electron } = require('playwright/test');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('shows the channel name in the player while keeping the selected quality', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-player-name-'));
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...appEnv } = process.env;
  const app = await electron.launch({
    args: ['.', '--disable-gpu'], cwd: path.resolve(__dirname, '..'),
    env: { ...appEnv, FREAKYIPTV_E2E: '1', FREAKYIPTV_DATA_DIR: root }
  });
  try {
    const page = app.windows()[0] || await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const playlistUrl = 'https://player-name.example.test/playlist.m3u';
    const channels = ['PT: RTP 1 Full HD', 'PT: RTP 1 HD'].map((name, index) => ({
      id: `channel-${index}`, tvgId: 'rtp1', name, groupTitle: 'Portugal',
      streamUrl: `https://player-name.example.test/${index}.mp4`, logoUrl: '', duration: -1, attributes: {}
    }));
    const settings = {
      playlistUrl, epgUrl: '', lastPlayedChannelId: '', favoriteChannelIds: [], recentlyViewedChannelIds: [],
      volume: 50, autoplayLastChannel: false, autoRefreshHours: 24, historyRetentionDays: 30,
      discordRpcEnabled: false, appearance: 'dark', language: 'en'
    };
    const cache = {
      schemaVersion: 1, playlistUrlHash: createHash('sha256').update(playlistUrl).digest('hex').slice(0, 16),
      epgUrlHash: '', parserVersion: 'react-ts-v1', savedAtUtc: new Date().toISOString(), channels, programs: [],
      epgChannelDisplayNames: {}, epgNormalizedNameMap: {}
    };
    await page.evaluate(async ({ settings, cache }) => {
      await window.electron.saveSettings(settings);
      await window.electron.saveCache(cache);
    }, { settings, cache });
    await page.reload();
    await page.getByRole('button', { name: 'Live TV', exact: true }).click();
    await expect(page.locator('.channel-card')).toHaveCount(1);
    await expect(page.locator('.channel-card')).toContainText('RTP 1');
    await page.locator('.channel-card > button').first().click();
    await expect(page.locator('.compact-channel')).toHaveText('RTP 1');
    await expect(page.locator('video')).toHaveAttribute('aria-label', 'RTP 1 live video');
    await expect(page.getByRole('button', { name: 'Choose stream quality. Current quality: FHD' })).toBeVisible();
    await page.getByRole('button', { name: 'Choose stream quality. Current quality: FHD' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'HD', exact: true })).toBeVisible();
    await page.getByRole('menuitemradio', { name: 'HD', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose stream quality. Current quality: HD' })).toBeVisible();
    await expect(page.locator('.compact-channel')).toHaveText('RTP 1');
    await page.getByRole('button', { name: 'Expand Player' }).click();
    await expect(page.locator('.hud-title')).toHaveText('RTP 1');
    await page.getByRole('button', { name: 'TV Guide', exact: true }).click();
    await expect(page.locator('.tv-guide-row')).toHaveCount(1);
    await expect(page.locator('.tv-guide-channel-name')).toHaveText('RTP 1');
  } finally {
    await closeTestApp(app);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
