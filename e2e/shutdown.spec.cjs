const { test, expect } = require('playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electronPath = require('electron');

// Shutdown must also work without Playwright's attached Node inspector, which
// can itself keep Electron waiting for debugger disconnection during app.quit.
for (const mode of ['normal', 'recording', 'missing-ack', 'dirty-cancel']) {
  test(`quits cleanly after the renderer close handshake: ${mode}`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-shutdown-'));
    const entry = path.join(root, 'entry.cjs');
    let child;
    try {
      // Electron's built-in module resolves from an application entry point.
      fs.writeFileSync(entry, `
        const { app, ipcMain } = require('electron');
        const fs = require('node:fs');
        const mode = ${JSON.stringify(mode)};
        const root = ${JSON.stringify(root)};
        const mark = name => { fs.writeFileSync(root + '/' + name, 'ok'); fs.appendFileSync(root + '/phases', Date.now() + ' ' + name + '\\n'); };
        app.on('before-quit', () => mark('before-quit'));
        app.on('will-quit', () => mark('will-quit'));
        app.on('browser-window-created', (_event, window) => {
          window.on('closed', () => mark('window-closed'));
          window.webContents.on('will-prevent-unload', () => mark('unload-prevented'));
          window.webContents.once('did-finish-load', async () => {
            mark('loaded');
            await window.webContents.executeJavaScript(\`new Promise(resolve => {
              const ready = () => {
                if (!document.body.textContent.includes('Add playlist')) return false;
                requestAnimationFrame(() => requestAnimationFrame(resolve));
                return true;
              };
              if (!ready()) {
                const observer = new MutationObserver(() => { if (ready()) observer.disconnect(); });
                observer.observe(document.body, { childList: true, subtree: true });
              }
            })\`);
            mark('ready');
            if (mode === 'missing-ack') ipcMain.removeAllListeners('app-close-ready');
            else ipcMain.on('app-close-ready', () => mark('acknowledged'));
            if (mode === 'recording') {
              ipcMain.removeHandler('get-recording-state');
              ipcMain.handle('get-recording-state', () => ({ status: 'recording' }));
              ipcMain.removeHandler('stop-source-recording');
              ipcMain.handle('stop-source-recording', async () => {
                await new Promise(resolve => setTimeout(resolve, 4100));
                mark('finalized');
                return { status: 'completed' };
              });
            }
            if (mode === 'dirty-cancel') {
              ipcMain.once('app-close-canceled', async () => {
                mark('canceled');
                await window.webContents.executeJavaScript('window.electron.loadHistory()');
                mark('store-usable');
                await window.webContents.executeJavaScript('window.confirm = () => true; undefined');
                app.quit();
              });
              await window.webContents.executeJavaScript(\`(async () => {
                [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Settings').click();
                await new Promise(resolve => {
                  const ready = () => document.querySelector('#settings-playlist-url');
                  if (ready()) return resolve();
                  const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); resolve(); } });
                  observer.observe(document.body, { childList: true, subtree: true });
                });
                const field = document.querySelector('#settings-playlist-url');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'https://settings.example.test/source.m3u');
                field.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                window.confirm = () => false;
              })()\`);
            }
            app.quit();
          });
        });
        require(${JSON.stringify(path.resolve(__dirname, '../main.cjs'))});
        app.on('will-quit', () => mark('will-quit'));
      `);
      child = spawn(electronPath, [entry, '--disable-gpu'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, FREAKYIPTV_E2E: '1', FREAKYIPTV_DATA_DIR: root, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`App failed to quit: ${stderr} Phases: ${fs.existsSync(path.join(root, 'phases')) ? fs.readFileSync(path.join(root, 'phases'), 'utf8') : 'none'}`)), 15000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      });
      expect(result).toEqual({ code: 0, signal: null });
      expect(fs.existsSync(path.join(root, 'will-quit'))).toBe(true);
      if (mode !== 'missing-ack') expect(fs.existsSync(path.join(root, 'acknowledged'))).toBe(true);
      if (mode === 'recording') expect(fs.readFileSync(path.join(root, 'finalized'), 'utf8')).toBe('ok');
      if (mode === 'dirty-cancel') {
        expect(fs.existsSync(path.join(root, 'canceled'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'store-usable'))).toBe(true);
      }
    } finally {
      if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
