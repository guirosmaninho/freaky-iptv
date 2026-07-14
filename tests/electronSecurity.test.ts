import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

type LookupResult = { address: string; family: number };
type LookupCallback = (
  error: Error | null,
  addressOrAddresses?: string | LookupResult[],
  family?: number
) => void;

function loadCreateGuardedLookup(
  resolveNetworkTarget: (hostname: string, allowPrivateNetwork: boolean) => Promise<LookupResult>
) {
  const source = readProjectFile('main.cjs');
  const functionSource = source.match(/function createGuardedLookup\(allowPrivateNetwork\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'createGuardedLookup implementation not found');

  const loadFunction = new Function(
    'resolveNetworkTarget',
    `${functionSource}; return createGuardedLookup;`
  ) as (
    resolveNetworkTarget: (hostname: string, allowPrivateNetwork: boolean) => Promise<LookupResult>
  ) => (allowPrivateNetwork: boolean) => (
    hostname: string,
    options: { all?: boolean },
    callback: LookupCallback
  ) => void;

  return loadFunction(resolveNetworkTarget);
}

describe('Electron security contract', () => {
  it('enables renderer isolation and blocks untrusted navigation', () => {
    const source = readProjectFile('main.cjs');

    assert.match(source, /sandbox:\s*true/);
    assert.match(source, /webSecurity:\s*true/);
    assert.match(source, /setWindowOpenHandler\(/);
    assert.match(source, /will-navigate/);
    assert.match(source, /will-redirect/);
    assert.match(source, /setPermissionRequestHandler\(/);
    assert.match(source, /setPermissionCheckHandler\(/);
  });

  it('routes privileged IPC through a trusted-sender guard', () => {
    const source = readProjectFile('main.cjs');
    const directHandles = [...source.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map(match => match[1]);
    const directListeners = [...source.matchAll(/ipcMain\.on\(['"]([^'"]+)['"]/g)].map(match => match[1]);

    assert.match(source, /function assertTrustedIpcSender\(/);
    assert.match(source, /event\.senderFrame/);
    assert.deepEqual(directHandles, []);
    assert.deepEqual(directListeners, []);
    assert.match(source, /assertPayloadSize\(settings,\s*MAX_SETTINGS_PAYLOAD_BYTES/);
    assert.match(source, /assertPayloadSize\(snapshot,\s*MAX_CACHE_PAYLOAD_BYTES/);
    assert.match(source, /assertPayloadSize\(sessions,\s*MAX_HISTORY_PAYLOAD_BYTES/);
  });

  it('blocks private network targets and rechecks redirects', () => {
    const source = readProjectFile('main.cjs');

    assert.match(source, /function isPrivateNetworkAddress\(/);
    assert.match(source, /async function resolveNetworkTarget\(/);
    assert.match(source, /async function shouldBlockRendererNetworkRequest\(/);
    assert.match(source, /webRequest\.onBeforeRequest\(\{\s*urls:\s*\['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]\s*\}/);
    assert.match(source, /await resolveNetworkTarget\(parsed\.hostname,\s*false\)/);
    assert.match(source, /!app\.isPackaged && process\.env\.FREAKYIPTV_E2E === '1' && isLoopbackHostname\(parsed\.hostname\)/);
    assert.match(source, /TRUSTED_LOCAL_MEDIA_URLS/);
    assert.match(source, /registerTrustedLocalMediaUrl\(relay\.url\)/);
    assert.match(source, /unregisterTrustedLocalMediaUrl\(relay\.url\)/);
    assert.match(source, /vlcOutputRelayServer\.freakyIptvTrustedUrl = trustedUrl/);
    assert.match(source, /registerTrustedLocalMediaUrl\(trustedUrl\)/);
    assert.match(source, /const allowPrivateNetwork = false/);
    assert.match(source, /requestRawUrl\(new URL\(location, parsedUrl\)\.toString\(\), redirectCount \+ 1/);
    assert.match(source, /pipeUrl\(new URL\(location, upstreamUrl\)\.toString\(\), redirectCount \+ 1/);
    assert.match(source, /openStreamingHttpRequest\(currentUrl, \{\s*allowPrivateNetwork: false,\s*maxRedirects: MAX_REDIRECTS,\s*resolveTarget: resolveNetworkTarget/);
    assert.doesNotMatch(source, /options\.allowPrivateNetwork/);
    assert.match(source, /function startUpstreamRelay\(sourceUrl\)/);
    assert.match(source, /registerTrustedHandle\('start-playback-relay'/);
  });

  it('returns an address list when Node requests lookup options.all', async () => {
    const createGuardedLookup = loadCreateGuardedLookup(async () => ({ address: '203.0.113.10', family: 4 }));
    const lookup = createGuardedLookup(false);

    await new Promise<void>((resolve, reject) => {
      lookup('example.com', { all: true }, (error, addresses, family) => {
        try {
          assert.ifError(error);
          assert.deepEqual(addresses, [{ address: '203.0.113.10', family: 4 }]);
          assert.equal(family, undefined);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
  });

  it('caps decompressed playlist and EPG bodies', () => {
    const source = readProjectFile('main.cjs');

    assert.match(source, /MAX_DECOMPRESSED_TEXT_BYTES/);
    assert.match(source, /maxOutputLength:\s*MAX_DECOMPRESSED_TEXT_BYTES/);
  });

  it('redacts stream URLs before logging and keeps Discord opt-in', () => {
    const mainSource = readProjectFile('main.cjs');
    const appSource = readProjectFile('src/App.tsx');
    const playerSource = readProjectFile('src/components/VideoPlayer.tsx');

    assert.match(mainSource, /function redactUrlForLogs\(/);
    assert.doesNotMatch(mainSource, /Starting low CPU relay for:\s*\$\{url\}/);
    assert.doesNotMatch(mainSource, /enabled:\s*true,\s*showChannel/);
    assert.doesNotMatch(playerSource, /proxy for URL/);
    assert.match(appSource, /useState\(false\).*discordRpcEnabled|discordRpcEnabled.*useState\(false\)/s);
  });

  it('uses OS-backed settings encryption and only blocks suspension during playback', () => {
    const mainSource = readProjectFile('main.cjs');
    const playerSource = readProjectFile('src/components/VideoPlayer.tsx');
    const encryptBody = mainSource.slice(mainSource.indexOf('function encrypt('), mainSource.indexOf('function decrypt('));

    assert.match(mainSource, /safeStorage\.encryptString/);
    assert.match(mainSource, /safeStorage\.decryptString/);
    assert.doesNotMatch(encryptBody, /createCipheriv|spawnSync/);
    assert.match(mainSource, /registerTrustedHandle\('set-playback-active'/);
    assert.match(playerSource, /setPlaybackActive\(true\)/);
    assert.match(playerSource, /setPlaybackActive\(false\)/);
  });

  it('uses trusted native window controls for fullscreen and Picture-in-Picture return', () => {
    const mainSource = readProjectFile('main.cjs');
    const preloadSource = readProjectFile('preload.cjs');
    const playerSource = readProjectFile('src/components/VideoPlayer.tsx');

    assert.match(mainSource, /registerTrustedHandle\('set-window-fullscreen'/);
    assert.match(mainSource, /registerTrustedHandle\('focus-app-window'/);
    assert.match(preloadSource, /setWindowFullscreen/);
    assert.match(preloadSource, /focusAppWindow/);
    assert.match(playerSource, /enterpictureinpicture/);
    assert.match(playerSource, /leavepictureinpicture/);
    assert.match(playerSource, /Return broadcast to app/);
  });

  it('keeps bug reporting on GitHub without an in-app report surface', () => {
    const mainSource = readProjectFile('main.cjs');
    const preloadSource = readProjectFile('preload.cjs');
    const aboutSource = readProjectFile('src/components/AboutTab.tsx');
    const typesSource = readProjectFile('src/types.ts');
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      dependencies?: Record<string, string>;
      repository?: { url?: string };
      bugs?: { url?: string };
      homepage?: string;
    };

    assert.match(mainSource, /https:\/\/github\.com\/guirosmaninho\/freaky-iptv/);
    assert.match(mainSource, /https:\/\/github\.com\/guirosmaninho\/freaky-iptv\/issues\/new/);
    assert.doesNotMatch(mainSource, /startsWith\(['"]https:\/\/github\.com\//);
    assert.doesNotMatch(mainSource, /BUG_REPORT_WEBHOOK_URL|submit-bug-report|postDiscordWebhook/);
    assert.doesNotMatch(preloadSource, /submitBugReport/);
    assert.doesNotMatch(typesSource, /BugReportRequest|BugReportResult|submitBugReport/);
    assert.doesNotMatch(aboutSource, /freaky-iptv-dev|support Discord|<form/);
    assert.doesNotMatch(aboutSource, /Report a bug|Create GitHub issue|NEW_ISSUE_URL/);
    assert.equal(packageJson.dependencies?.dotenv, undefined);
    assert.equal(packageJson.repository?.url, 'https://github.com/guirosmaninho/freaky-iptv.git');
    assert.equal(packageJson.bugs?.url, 'https://github.com/guirosmaninho/freaky-iptv/issues');
    assert.equal(packageJson.homepage, 'https://github.com/guirosmaninho/freaky-iptv#readme');
  });

  it('ships a restrictive CSP and keeps native helpers unpacked from ASAR', () => {
    const html = readProjectFile('index.html');
    const mainSource = readProjectFile('main.cjs');
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      build?: { asar?: boolean; asarUnpack?: string[] };
    };

    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /object-src 'none'/);
    assert.match(mainSource, /Content-Security-Policy'[\s\S]*frame-ancestors 'none'/);
    assert.match(html, /worker-src 'self' blob:/);
    assert.equal(packageJson.build?.asar, true);
    assert.ok(packageJson.build?.asarUnpack?.includes('native-runtime-package/**'));
  });

  it('uses the FreakyIPTV data directory and exposes bounded media and backup IPC', () => {
    const mainSource = readProjectFile('main.cjs');
    const preloadSource = readProjectFile('preload.cjs');

    assert.match(mainSource, /resolvePlatformDirectories\(/);
    assert.match(mainSource, /getNativeRuntimePath\(/);
    assert.match(mainSource, /migrateLegacyData\(/);
    assert.match(mainSource, /registerTrustedHandle\('export-backup'/);
    assert.match(mainSource, /registerTrustedHandle\('import-backup'/);
    assert.match(mainSource, /registerTrustedHandle\('capture-playback-frame'/);
    assert.match(mainSource, /registerTrustedHandle\('start-source-recording'/);
    assert.match(mainSource, /registerTrustedHandle\('start-playback-relay'/);
    assert.match(mainSource, /registerTrustedHandle\('stop-playback-relay'/);
    assert.match(mainSource, /registerTrustedHandle\('get-playback-relay-traffic'/);
    assert.match(mainSource, /const recordingInputUrl = relay \? relay\.url : request\.sourceUrl/);
    assert.match(mainSource, /registerTrustedHandle\('copy-statistics-card'/);
    assert.match(mainSource, /registerTrustedHandle\('save-statistics-card'/);
    assert.doesNotMatch(mainSource, /registerTrustedHandle\('begin-playback-recording'/);
    assert.match(mainSource, /registerTrustedHandle\('copy-text'/);
    assert.match(mainSource, /resolve\(\{\s*ok:\s*true,\s*url:/);
    assert.match(preloadSource, /exportBackup/);
    assert.match(preloadSource, /capturePlaybackFrame/);
    assert.match(preloadSource, /startPlaybackRelay/);
    assert.match(preloadSource, /stopPlaybackRelay/);
    assert.match(preloadSource, /copyStatisticsCard/);
    assert.match(preloadSource, /saveStatisticsCard/);
    assert.match(preloadSource, /onRecordingStateChange/);
    assert.doesNotMatch(preloadSource, /discord\.com\/api\/webhooks/);
    assert.doesNotMatch(readProjectFile('src/components/AboutTab.tsx'), /discord\.com\/api\/webhooks/);
  });
});
