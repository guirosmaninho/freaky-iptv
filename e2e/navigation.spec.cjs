const { closeTestApp } = require('./closeTestApp.cjs');
const { test, expect, _electron: electron } = require('playwright/test');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test.describe.configure({ mode: 'serial' });

let app;
let page;
let fixtureRoot;

const settings = {
  playlistUrl: '', epgUrl: '', lastPlayedChannelId: '', favoriteChannelIds: [], recentlyViewedChannelIds: [],
  volume: 50, autoplayLastChannel: false, autoRefreshHours: 24, historyRetentionDays: 30,
  discordRpcEnabled: false, discordShowChannel: false, discordShowProgram: false, discordShowArtwork: false,
  appearance: 'dark', language: 'en'
};

async function seedLargePlaylist() {
  const playlistUrl = 'https://navigation.example.test/channels.m3u';
  const now = Date.now();
  const channels = Array.from({ length: 400 }, (_, index) => ({
    id: `navigation-${index}`, tvgId: `navigation-${index}`, name: `Channel ${String(index).padStart(3, '0')}`,
    groupTitle: index % 2 ? 'Sports' : 'General', streamUrl: `https://navigation.example.test/stream?channel=${index}`, logoUrl: '', duration: -1, attributes: {}
  }));
  const programs = channels.flatMap(channel => [0, 1].map(slot => ({
    channelId: channel.id, title: `${slot ? 'Next' : 'Current'} ${channel.name}`, subTitle: '', description: '', category: '', iconUrl: '',
    startUtc: new Date(now + (slot ? 60 : -60) * 60000).toISOString(),
    stopUtc: new Date(now + (slot ? 120 : 60) * 60000).toISOString(), rawStart: '', rawStop: ''
  })));
  const cache = {
    schemaVersion: 1, playlistUrlHash: createHash('sha256').update(playlistUrl).digest('hex').slice(0, 16),
    epgUrlHash: '', parserVersion: 'react-ts-v1', savedAtUtc: new Date().toISOString(), channels, programs,
    epgChannelDisplayNames: {}, epgNormalizedNameMap: {}
  };
  await page.evaluate(async ({ nextSettings, cacheSnapshot }) => {
    sessionStorage.clear();
    localStorage.clear();
    await window.electron.saveSettings(nextSettings);
    await window.electron.saveCache(cacheSnapshot);
  }, { nextSettings: { ...settings, playlistUrl, favoriteChannelIds: channels.slice(0, 200).map(channel => channel.id) }, cacheSnapshot: cache });
  await page.reload();
  await expect(page.locator('.home-greeting-hero')).toBeVisible();
}

test.beforeAll(async () => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-navigation-'));
  app = await electron.launch({
    args: ['.', '--disable-gpu'], cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, FREAKYIPTV_E2E: '1', FREAKYIPTV_DATA_DIR: fixtureRoot, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  page = app.windows()[0] || await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(async nextSettings => { await window.electron.saveSettings(nextSettings); }, settings);
  await page.reload();
});

test.afterAll(async () => {
  try {
    await closeTestApp(app);
  } finally {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('offers playlist setup before channels have been configured', async () => {
  await expect(page.getByRole('button', { name: 'Add playlist', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add playlist', exact: true }).click();
  await expect(page.locator('.settings-page')).toBeVisible();
  await seedLargePlaylist();
  await expect(page.getByRole('button', { name: 'View all favorites', exact: true })).toBeVisible();
  await expect(page.locator('.home-now-section')).toBeVisible();
});

test('restores independent tab filters, position and density with bounded channel DOM', async () => {
  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await page.locator('#live-category').selectOption('General');
  await page.getByRole('searchbox', { name: 'Search channels or programmes', exact: true }).fill('Channel');
  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await page.locator('.navigation-channel-scroll').evaluate(element => { element.scrollTop = 1800; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('.channel-card').count()).toBeLessThan(100);

  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search channels or programmes', exact: true })).toHaveValue('');
  await page.getByRole('searchbox', { name: 'Search channels or programmes', exact: true }).fill('Channel 00');
  await page.getByRole('button', { name: 'Large', exact: true }).click();

  await page.getByRole('button', { name: 'Live TV', exact: true }).click();
  await expect(page.locator('#live-category')).toHaveValue('General');
  await expect(page.getByRole('searchbox', { name: 'Search channels or programmes', exact: true })).toHaveValue('Channel');
  await expect(page.getByRole('button', { name: 'Compact', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.navigation-channel-scroll').evaluate(element => element.scrollTop)).toBe(1800);

  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search channels or programmes', exact: true })).toHaveValue('Channel 00');
  await expect(page.getByRole('button', { name: 'Large', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('activates reminders with the keyboard without starting playback and retains focus while windowing', async () => {
  await page.getByRole('button', { name: 'TV Guide', exact: true }).click();
  const reminder = page.getByRole('button', { name: 'Set reminder for Next Channel 000', exact: true });
  await reminder.focus();
  await reminder.press('Enter');
  const setReminder = page.getByRole('button', { name: 'Remove reminder for Next Channel 000', exact: true });
  await expect(setReminder).toHaveAttribute('aria-pressed', 'true');
  await setReminder.press('Space');
  await expect(page.locator('.player-shell')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set reminder for Next Channel 000', exact: true })).toHaveAttribute('aria-pressed', 'false');

  const play = page.getByRole('button', { name: 'Play Channel 000', exact: true });
  await play.focus();
  await page.locator('.tv-guide-scroll').evaluate(element => { element.scrollTop = 20000; element.dispatchEvent(new Event('scroll')); });
  await expect(play).toBeFocused();
  await expect.poll(() => page.locator('.tv-guide-row').count()).toBeLessThan(20);
  await play.press('Tab');
  await expect(page.getByRole('button', { name: 'Set reminder for Current Channel 000', exact: true })).toBeFocused();
  await expect(page.locator('.player-shell')).toHaveCount(0);
});

test('saves Portuguese, checks compact layouts and restores the saved theme', async () => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Application language', exact: true }).selectOption('pt-PT');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Definições', exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar alterações', exact: true })).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');
  await page.getByRole('radio', { name: 'Claro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/settings-portuguese-light.png' });
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Privacidade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Definições', level: 1 })).toHaveCount(1);
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('Esta ação não pode ser desfeita');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Limpar histórico', exact: true }).click();
  const forever = page.getByRole('checkbox', { name: 'Guardar sempre', exact: true });
  await forever.check();
  await expect(page.getByRole('spinbutton', { name: 'Guardar histórico durante (dias)', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await page.getByRole('button', { name: 'TV em direto', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^TV em direto/, level: 2 })).toBeVisible();
  await page.getByRole('searchbox').fill('Channel 000');
  await expect(page.locator('.channel-card')).toHaveCount(1);
  await expect(page.locator('.channel-card')).toContainText('Channel 000');
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/live-portuguese.png' });
  await page.getByRole('button', { name: 'Definições', exact: true }).click();
  await page.getByRole('button', { name: 'Aspeto', exact: true }).click();
  await page.getByRole('combobox').selectOption('en');
  await page.getByRole('button', { name: 'Guardar alterações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 2 })).toBeVisible();
});

test('keeps light-mode guide controls readable and numeric fields editable', async () => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  const refresh = page.getByRole('spinbutton', { name: 'Refresh sources every (hours)', exact: true });
  await refresh.fill('');
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: 'Off', exact: true })).not.toBeChecked();
  await refresh.fill('12');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'TV Guide', exact: true }).click();
  await page.locator('.tv-guide-scroll').evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole('button', { name: 'Set reminder for Next Channel 000', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/guide-light-narrow.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
});

test('offers a retry when initial statistics loading fails', async () => {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('load-history');
    ipcMain.handle('load-history', () => { throw new Error('Fixture storage unavailable.'); });
  });
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to load statistics.');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('load-history');
    ipcMain.handle('load-history', () => []);
  });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.stats-page')).toBeVisible();
});
