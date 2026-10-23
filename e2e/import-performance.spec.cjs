const { closeTestApp } = require('./closeTestApp.cjs');
const { test, expect, _electron: electron } = require('playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

test('imports large sources in workers, bounds the DOM and retains the guide after invalid XML', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-import-'));
  let app, server;
  let malformed = false;
  const count = 2000;
  const xmlTime = value => new Date(value).toISOString().slice(0, 19).replace(/[-:T]/g, '') + ' +0000';
  const now = Date.now();
  try {
    server = http.createServer((request, response) => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (request.url === '/channels.m3u') {
        const body = ('#EXTM3U\n' + Array.from({ length: count }, (_, index) => `#EXTINF:-1 tvg-id="import-${index}" group-title="General",Import ${String(index).padStart(4, '0')}\n${origin}/stream?id=${index}`).join('\n'));
        response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': [Buffer.byteLength(body), Buffer.byteLength(body)] });
        response.end(body);
      } else {
        response.writeHead(200, { 'Content-Type': 'application/xml' });
        response.end(malformed ? `<tv><programme channel="import-0" start="${xmlTime(now - 3600000)}" stop="${xmlTime(now + 3600000)}"><title>Bad & title</title></programme></tv>` : '<tv>' + Array.from({ length: count }, (_, index) => `<channel id="import-${index}"><display-name>Import ${index}</display-name></channel><programme channel="import-${index}" start="${xmlTime(now - 3600000)}" stop="${xmlTime(now + 3600000)}"><title>Bulletin ${index}</title></programme>`).join('') + '</tv>');
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    app = await electron.launch({ args: ['.', '--disable-gpu'], cwd: path.resolve(__dirname, '..'), env: { ...process.env, FREAKYIPTV_E2E: '1', FREAKYIPTV_DATA_DIR: root, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
    // Keep the production SSRF restriction intact. This disposable adapter
    // permits only this fixture server in the test app's main process.
    await app.evaluate(({ ipcMain }, fixtureOrigin) => {
      ipcMain.removeHandler('download-url-text');
      ipcMain.handle('download-url-text', async (_event, value) => {
        const url = new URL(value);
        if (url.origin !== fixtureOrigin) throw new Error('Unexpected fixture URL.');
        const requireFromApp = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/package.json`);
        const { openStreamingHttpRequest } = requireFromApp('./electron/streamingHttpCore.cjs');
        const response = await openStreamingHttpRequest(url.toString(), {
          allowPrivateNetwork: true,
          resolveTarget: async hostname => {
            if (hostname !== '127.0.0.1') throw new Error('Unexpected fixture host.');
            return { address: '127.0.0.1', family: 4 };
          }
        });
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        return Buffer.concat(chunks).toString('utf8');
      });
    }, origin);
    const page = app.windows()[0] || await app.firstWindow();
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.__parserWorkers = 0;
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); window.__parserWorkers++; }
      };
    });
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Add playlist', exact: true }).click();
    await page.locator('#settings-playlist-url').fill(`${origin}/channels.m3u`);
    await page.locator('#settings-epg-url').fill(`${origin}/guide.xml`);
    await page.getByRole('button', { name: 'Synchronize now', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Live TV/, level: 2 })).toBeVisible();
    expect(await page.evaluate(() => window.__parserWorkers)).toBe(2);
    await expect(page.locator('.page-result-count')).toHaveText('2,000');
    expect(await page.locator('.channel-card').count()).toBeLessThan(100);
    await page.locator('.navigation-channel-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('button', { name: 'Play Import 1999', exact: true })).toBeVisible();
    expect(await page.locator('.channel-card').count()).toBeLessThan(100);
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/live-large-playlist.png' });
    await page.getByRole('button', { name: 'TV Guide', exact: true }).click();
    await expect(page.getByText('Bulletin 0', { exact: true })).toBeVisible();
    expect(await page.locator('.tv-guide-row').count()).toBeLessThan(20);
    await page.screenshot({ animations: 'disabled', path: 'output/playwright/guide-large-playlist.png' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(page.locator('.settings-save-bar')).toContainText('Sources connected: 2,000 channels, 2,000 programmes.');
    malformed = true;
    await page.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(page.locator('.settings-save-bar')).toContainText('Playlist connected: 2,000 channels. The TV guide source returned invalid XMLTV.');
    await page.getByRole('button', { name: 'Synchronize now', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^Live TV/, level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'TV Guide', exact: true }).click();
    await expect(page.getByText('Bulletin 0', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__parserWorkers)).toBe(8);
  } finally {
    await closeTestApp(app);
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
