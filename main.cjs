const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net: electronNet, Notification, powerSaveBlocker, protocol, safeStorage, shell } = require('electron');

if (process.env.FREAKYIPTV_E2E === '1') {
  app.disableHardwareAcceleration();
}
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
// Disable Chromium autoplay restrictions to prevent playback stalling on boot/channel change
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Keep hardware acceleration and DirectComposition video paths enabled for lower CPU usage.
app.commandLine.appendSwitch('disable-features', [
  'CalculateNativeWinOcclusion'
].join(','));

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const dns = require('dns');
const zlib = require('zlib');
const { execSync, spawn, spawnSync } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const { normalizeHistoryList } = require('./historyStorage.cjs');
const { decryptBackup, encryptBackup, mergeImportedData, validateBackupPassword } = require('./electron/backupCore.cjs');
const { getDiscordIpcPaths } = require('./electron/discordRpcCore.cjs');
const { assertWritableDirectory, clampCaptureBounds, createUniqueMediaPath, decodePngDataUrl, sanitizeFilePart, validatePngBuffer } = require('./electron/mediaCore.cjs');
const { createPortableReplacementPlan, isSafePortableExecutablePath } = require('./electron/portableUpdate.cjs');
const { createFileSnapshot, migrateLegacyData, restoreFileSnapshot } = require('./electron/storageCore.cjs');
const { createDataStore } = require('./electron/dataStore.cjs');
const { openStreamingHttpRequest } = require('./electron/streamingHttpCore.cjs');
const { compareVersions, isTrustedGithubAssetUrl, isTrustedGithubRedirectUrl, PROJECT_OWNER, PROJECT_REPOSITORY, selectReleaseCandidate } = require('./electron/updateCore.cjs');
const { getFfmpegProbeArgs, getFfmpegProxyModes, getNativeRuntimeDirectory, getNextFfmpegProxyMode, resolvePlatformDirectories } = require('./electron/platformCore.cjs');

// Keep all application-owned state under the platform's standard application
// data directory. Tests can isolate this with FREAKYIPTV_DATA_DIR.
const PLATFORM_DIRECTORIES = resolvePlatformDirectories({
  platform: process.platform,
  env: process.env,
  appDataPath: app.getPath('appData'),
  videosPath: app.getPath('videos')
});
const LEGACY_DATA_DIR = PLATFORM_DIRECTORIES.legacyDir;
const DATA_DIR = PLATFORM_DIRECTORIES.dataDir;
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const RECORDING_THUMBNAIL_DIR = path.join(CACHE_DIR, 'recording-thumbnails');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CACHE_FILE = path.join(CACHE_DIR, 'snapshot.json');
const HISTORY_FILE = path.join(DATA_DIR, 'watch_history.json');
const DATABASE_FILE = path.join(DATA_DIR, 'freaky-iptv.sqlite');
const DEFAULT_RECORDING_DIR = PLATFORM_DIRECTORIES.recordingDir;
const MAX_TEXT_DOWNLOAD_BYTES = 150 * 1024 * 1024;
const MAX_DECOMPRESSED_TEXT_BYTES = 150 * 1024 * 1024;
const MAX_SETTINGS_PAYLOAD_BYTES = 1024 * 1024;
const MAX_CACHE_PAYLOAD_BYTES = 256 * 1024 * 1024;
const MAX_HISTORY_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_URL_LENGTH = 8192;
const MAX_REDIRECTS = 5;
const DNS_CACHE_SUCCESS_TTL_MS = 30 * 1000;
const DNS_CACHE_FAILURE_TTL_MS = 5 * 1000;
const MAX_DISCORD_PACKET_BYTES = 1024 * 1024;
const MAX_DISCORD_ASSET_LENGTH = 256;
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_RECORDING_THUMBNAIL_BYTES = 4 * 1024 * 1024;
const MAX_UPDATE_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const PROJECT_URL = 'https://github.com/guirosmaninho/freaky-iptv';
const NEW_ISSUE_URL = 'https://github.com/guirosmaninho/freaky-iptv/issues/new';
const GITHUB_RELEASES_URL = `${PROJECT_URL}/releases/latest`;
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${PROJECT_OWNER}/${PROJECT_REPOSITORY}/releases/latest`;
const ALLOWED_EXTERNAL_URLS = new Set([PROJECT_URL, NEW_ISSUE_URL, GITHUB_RELEASES_URL]);
const TRUSTED_LOCAL_MEDIA_URLS = new Set();
const networkDnsCache = new Map();

const migrationStatus = process.env.FREAKYIPTV_E2E === '1'
  ? { migrated: false, status: 'test-isolated', copied: [] }
  : LEGACY_DATA_DIR ? migrateLegacyData({ legacyDir: LEGACY_DATA_DIR, dataDir: DATA_DIR }) : { migrated: false, status: 'not-applicable', copied: [] };
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(RECORDING_THUMBNAIL_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
app.setPath('userData', path.join(DATA_DIR, 'electron'));
const dataStore = createDataStore({
  dataDir: DATA_DIR,
  legacyHistoryFile: HISTORY_FILE,
  legacyCacheFile: CACHE_FILE
});
let dataRecoveryNotice = null;

// --- Discord Rich Presence State (declared early so applyDiscordSettings can reference them at startup) ---
let discordRpcSocket = null;
let discordClientId = '1514411481259577364';
let isDiscordConnected = false;
let isConnecting = false;
let discordConnectTimeout = null;
let discordReadBuffer = Buffer.alloc(0);
let currentDiscordSettings = {
  enabled: true,
  showChannel: true,
  showProgram: true,
  showArtwork: true,
  clientId: '1514411481259577364'
};
let lastActiveChannelName = null;
let lastActiveChannelStartTime = null;
let lastActiveChannelLogoUrl = null;
let lastActiveChannelProgramTitle = null;

// Safe Encryption Key Derivation for legacy Windows fallback values only.
let encryptionKey = null;
function getEncryptionKey() {
  if (process.platform !== 'win32') {
    throw new Error('The legacy Windows fallback encryption is unavailable on this platform.');
  }
  if (encryptionKey) return encryptionKey;
  try {
    let machineGuid = '';
    try {
      const output = execSync('reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8' });
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match && match[1]) {
        machineGuid = match[1].trim();
      }
    } catch (e) {
      machineGuid = process.env.COMPUTERNAME || 'NebulaDefaultMachineGuid';
    }

    const username = process.env.USERNAME || 'NebulaUser';
    const salt = crypto.scryptSync(username, 'NebulaSalt', 16);
    // Derive a 256-bit key from machine GUID and username
    encryptionKey = crypto.pbkdf2Sync(machineGuid + '_' + username, salt, 10000, 32, 'sha256');
    return encryptionKey;
  } catch (err) {
    console.error('Failed to derive encryption key, fallback to static salt:', err);
    encryptionKey = crypto.pbkdf2Sync('FallbackMasterSecret', 'NebulaFallbackSalt', 10000, 32, 'sha256');
    return encryptionKey;
  }
}

// Encrypt new settings with Electron's OS-backed credential storage. Legacy
// DPAPI/AES values remain readable below so existing users are migrated on save.
function encrypt(text) {
  if (!text) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed encryption is not available.');
  }
  return `safeStorage:${safeStorage.encryptString(text).toString('base64')}`;
}

// Decrypt current and legacy settings formats.
function decrypt(base64Text) {
  if (!base64Text) return '';

  if (base64Text.startsWith('safeStorage:')) {
    try {
      return safeStorage.decryptString(Buffer.from(base64Text.slice('safeStorage:'.length), 'base64'));
    } catch (error) {
      console.error('Failed to decrypt OS-protected settings:', error);
      return '';
    }
  }
  
  // The fallback scheme was used only by old Windows releases. New values are
  // always stored through Electron safeStorage (Keychain on macOS).
  if (base64Text.startsWith('fallback:')) {
    if (process.platform !== 'win32') return '';
    try {
      const parts = base64Text.split(':');
      const iv = Buffer.from(parts[1], 'hex');
      const encryptedText = parts[2];
      const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
      let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (fallbackErr) {
      console.error('Crypto fallback decryption failed:', fallbackErr);
      return base64Text;
    }
  }

  if (process.platform !== 'win32') {
    // A raw URL can come from an old, unencrypted settings file. DPAPI values
    // cannot be decrypted outside Windows and must instead be restored through
    // the password-encrypted backup flow.
    return /^https?:\/\//i.test(base64Text) ? base64Text : '';
  }

  try {
    const helperPath = getNativeRuntimePath('dpapi', 'dpapi-helper.exe');
    if (fs.existsSync(helperPath)) {
      const result = spawnSync(helperPath, ['unprotect', base64Text], { encoding: 'utf8' });
      if (result.status === 0 && result.stdout) {
        return result.stdout.trim();
      }
    }
    throw new Error('DPAPI helper not found or failed');
  } catch (err) {
    console.warn('DPAPI decryption failed, trying fallback crypto decrypt (in case key format matches):', err.message || err);
    return base64Text;
  }
}

// Atomic file writing
function writeJsonAtomic(filePath, data) {
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function normalizeOpenedReviewIds(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const seen = new Set();
  for (let index = values.length - 1; index >= 0 && result.length < 128; index -= 1) {
    const value = values[index];
    if (typeof value !== 'string' || !/^(weekly|monthly|annual):[A-Za-z0-9._-]{1,48}$/.test(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result.reverse();
}

function serializeSettingsForDisk(settings) {
  return {
    SettingsRevision: Number.isSafeInteger(settings.settingsRevision) ? settings.settingsRevision : 0,
    PlaylistUrl: encrypt(settings.playlistUrl),
    EpgUrl: encrypt(settings.epgUrl),
    LastPlayedChannelId: settings.lastPlayedChannelId || '',
    FavoriteChannelIds: settings.favoriteChannelIds || [],
    RecentlyViewedChannelIds: settings.recentlyViewedChannelIds || [],
    Volume: settings.volume,
    QualityMappings: settings.qualityMappings || null,
    AutoRefreshHours: settings.autoRefreshHours,
    AutoplayLastChannel: settings.autoplayLastChannel,
    HistoryRetentionDays: settings.historyRetentionDays,
    DiscordRpcEnabled: settings.discordRpcEnabled !== undefined ? settings.discordRpcEnabled : true,
    DiscordShowChannel: settings.discordShowChannel !== undefined ? settings.discordShowChannel : true,
    DiscordShowProgram: settings.discordShowProgram !== undefined ? settings.discordShowProgram : true,
    DiscordShowArtwork: settings.discordShowArtwork !== undefined ? settings.discordShowArtwork : true,
    DiscordArtworkPreferenceVersion: 1,
    DiscordClientId: settings.discordClientId || '1514411481259577364',
    Appearance: settings.appearance || 'system',
    Language: ['system', 'pt-PT', 'en'].includes(settings.language) ? settings.language : 'system',
    RecordingDirectory: settings.recordingDirectory || DEFAULT_RECORDING_DIR,
    RecordingMode: 'source-mkv',
    OpenedReviewIds: normalizeOpenedReviewIds(settings.openedReviewIds),
    DismissedReviewIds: normalizeOpenedReviewIds(settings.dismissedReviewIds)
  };
}

function saveSettingsToFile(settings) {
  validateSettingsPayload(settings);
  writeJsonAtomic(SETTINGS_FILE, serializeSettingsForDisk(settings));
}

// IPC Handlers
function loadSettingsFromFile() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {
      playlistUrl: '',
      epgUrl: '',
      favoriteChannelIds: [],
      recentlyViewedChannelIds: [],
      volume: 80,
      qualityMappings: null,
      autoRefreshHours: 4,
      autoplayLastChannel: true,
      historyRetentionDays: 365,
      discordRpcEnabled: true,
      discordShowChannel: true,
      discordShowProgram: true,
      discordShowArtwork: true,
      discordClientId: '1514411481259577364',
      appearance: 'system',
      language: 'system',
      recordingDirectory: DEFAULT_RECORDING_DIR,
      recordingMode: 'source-mkv',
      openedReviewIds: [],
      dismissedReviewIds: []
    };
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    
    const hasDiscordArtworkPreference = data.DiscordArtworkPreferenceVersion === 1;
    const storedDiscordShowArtwork = data.DiscordShowArtwork;

    return {
      settingsRevision: Number.isSafeInteger(data.SettingsRevision) ? data.SettingsRevision : 0,
      playlistUrl: decrypt(data.PlaylistUrl || data.playlistUrl),
      epgUrl: decrypt(data.EpgUrl || data.epgUrl),
      lastPlayedChannelId: data.LastPlayedChannelId || data.lastPlayedChannelId || '',
      favoriteChannelIds: data.FavoriteChannelIds || data.favoriteChannelIds || [],
      recentlyViewedChannelIds: data.RecentlyViewedChannelIds || data.recentlyViewedChannelIds || [],
      volume: data.Volume !== undefined ? data.Volume : (data.volume !== undefined ? data.volume : 80),
      qualityMappings: data.QualityMappings || data.qualityMappings || null,
      autoRefreshHours: data.AutoRefreshHours !== undefined ? data.AutoRefreshHours : 4,
      autoplayLastChannel: data.AutoplayLastChannel !== undefined ? data.AutoplayLastChannel : true,
      historyRetentionDays: data.HistoryRetentionDays !== undefined ? data.HistoryRetentionDays : 365,
      discordRpcEnabled: data.DiscordRpcEnabled !== undefined ? data.DiscordRpcEnabled : true,
      discordShowChannel: data.DiscordShowChannel !== undefined ? data.DiscordShowChannel : true,
      // Legacy builds did not expose the artwork switch. Restore the previous
      // behaviour for those settings, while preserving an explicit choice
      // after the preference version has been written.
      discordShowProgram: data.DiscordShowProgram !== undefined ? data.DiscordShowProgram : true,
      discordShowArtwork: hasDiscordArtworkPreference
        ? storedDiscordShowArtwork === true
        : storedDiscordShowArtwork !== false,
      discordClientId: data.DiscordClientId || '1514411481259577364',
      appearance: ['system', 'light', 'dark'].includes(data.Appearance) ? data.Appearance : 'system',
      language: ['system', 'pt-PT', 'en'].includes(data.Language) ? data.Language : 'system',
      recordingDirectory: typeof data.RecordingDirectory === 'string' && data.RecordingDirectory ? data.RecordingDirectory : DEFAULT_RECORDING_DIR,
      recordingMode: 'source-mkv',
      openedReviewIds: normalizeOpenedReviewIds(data.OpenedReviewIds || data.openedReviewIds),
      dismissedReviewIds: normalizeOpenedReviewIds(data.DismissedReviewIds || data.dismissedReviewIds)
    };
  } catch (err) {
    console.error('Failed to load settings:', err);
    return {
      playlistUrl: '',
      epgUrl: '',
      favoriteChannelIds: [],
      recentlyViewedChannelIds: [],
      volume: 80,
      qualityMappings: null,
      autoRefreshHours: 4,
      autoplayLastChannel: true,
      historyRetentionDays: 365,
      discordRpcEnabled: true,
      discordShowChannel: true,
      discordShowProgram: true,
      discordShowArtwork: true,
      discordClientId: '1514411481259577364',
      appearance: 'system',
      language: 'system',
      recordingDirectory: DEFAULT_RECORDING_DIR,
      recordingMode: 'source-mkv',
      openedReviewIds: [],
      dismissedReviewIds: []
    };
  }
}

registerTrustedHandle('load-settings', () => {
  return loadSettingsFromFile();
});

registerTrustedHandle('save-settings', (event, settings) => {
  try {
    saveSettingsToFile(settings);
    applyDiscordSettings(
      settings.discordRpcEnabled,
      settings.discordShowChannel,
      settings.discordShowProgram,
      settings.discordShowArtwork,
      settings.discordClientId
    );
    return true;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return false;
  }
});

// Small, serialized preference updates avoid a delayed volume write replacing
// unrelated settings that were saved in the meantime.
let settingsPatchQueue = Promise.resolve();
registerTrustedHandle('patch-settings', async (event, patch) => {
  try {
    assertPlainObject(patch, 'Settings patch');
    const allowedKeys = new Set([
      'volume', 'appearance', 'language', 'discordRpcEnabled',
      'discordShowChannel', 'discordShowProgram', 'discordShowArtwork'
    ]);
    for (const key of Object.keys(patch)) {
      if (!allowedKeys.has(key)) throw new TypeError(`Unsupported settings patch '${key}'.`);
    }

    let saved;
    const runPatch = settingsPatchQueue.catch(() => {}).then(async () => {
      const current = loadSettingsFromFile();
      const next = { ...current, ...patch, settingsRevision: (current.settingsRevision || 0) + 1 };
      validateSettingsPayload(next);
      saveSettingsToFile(next);
      applyDiscordSettings(
        next.discordRpcEnabled,
        next.discordShowChannel,
        next.discordShowProgram,
        next.discordShowArtwork,
        next.discordClientId
      );
      saved = next;
    });
    settingsPatchQueue = runPatch;
    await runPatch;
    return { ok: true, settings: saved, revision: saved.settingsRevision };
  } catch (err) {
    console.error('Failed to patch settings:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to patch settings.' };
  }
});

registerTrustedHandle('load-cache', async () => {
  try {
    return await dataStore.getCache();
  } catch (err) {
    console.error('Failed to load cache:', err);
    return null;
  }
});

registerTrustedHandle('save-cache', async (event, snapshot) => {
  try {
    assertPlainObject(snapshot, 'Cache snapshot');
    assertPayloadSize(snapshot, MAX_CACHE_PAYLOAD_BYTES, 'Cache snapshot');
    await dataStore.setCache(snapshot);
    return true;
  } catch (err) {
    console.error('Failed to save cache:', err);
    return false;
  }
});

registerTrustedHandle('load-history', async () => {
  try {
    const list = await dataStore.loadHistory();
    const { cleaned, dirty } = normalizeHistoryList(list);
    if (dirty) {
      await dataStore.saveHistory(cleaned);
    }

    return cleaned;
  } catch (err) {
    console.error('Failed to load watch history:', err);
    return [];
  }
});

registerTrustedHandle('save-history', async (event, sessions) => {
  try {
    if (!Array.isArray(sessions)) throw new TypeError('History sessions must be an array.');
    assertPayloadSize(sessions, MAX_HISTORY_PAYLOAD_BYTES, 'History sessions');
    await dataStore.saveHistory(normalizeHistoryList(sessions).cleaned);
    return true;
  } catch (err) {
    console.error('Failed to save watch history:', err);
    return false;
  }
});

registerTrustedHandle('append-history', async (event, session) => {
  try {
    assertPlainObject(session, 'History session');
    assertPayloadSize(session, MAX_HISTORY_PAYLOAD_BYTES, 'History session');
    const normalized = normalizeHistoryList([session]).cleaned;
    if (normalized.length !== 1) throw new TypeError('History session is invalid.');
    await dataStore.appendHistory(normalized[0]);
    return true;
  } catch (err) {
    console.error('Failed to append watch history:', err);
    return false;
  }
});

function getFileStorageInfo(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return {
      bytes: stats.size,
      updatedAtUtc: stats.mtime.toISOString()
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { bytes: 0, updatedAtUtc: '' };
    }
    throw err;
  }
}

function getUnpackedResourcePath(relativePath) {
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : __dirname;
  return path.join(basePath, relativePath);
}

function getNativeRuntimePath(...relativeParts) {
  if (app.isPackaged) {
    return getUnpackedResourcePath(path.join('native-runtime-package', ...relativeParts));
  }
  return path.join(__dirname, 'native-runtime', getNativeRuntimeDirectory(process.platform, process.arch), ...relativeParts);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertPayloadSize(value, maxBytes, label) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') {
    throw new TypeError(`${label} is not serializable.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new RangeError(`${label} is too large.`);
  }
}

function assertBoundedString(value, label, maxLength, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new TypeError(`${label} must be a string no longer than ${maxLength} characters.`);
  }
}

function assertStringArray(value, label, maxItems = 100000) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be an array with at most ${maxItems} items.`);
  }
  for (const item of value) {
    assertBoundedString(item, `${label} item`, 1024);
  }
}

function assertHttpUrlText(value, label, optional = false) {
  if (optional && !value) return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`${label} must use HTTP or HTTPS.`);
  }
}

function validateSettingsPayload(settings) {
  assertPlainObject(settings, 'Settings');
  assertPayloadSize(settings, MAX_SETTINGS_PAYLOAD_BYTES, 'Settings');
  assertBoundedString(settings.playlistUrl, 'Playlist URL', MAX_URL_LENGTH, true);
  assertBoundedString(settings.epgUrl, 'EPG URL', MAX_URL_LENGTH, true);
  assertHttpUrlText(settings.playlistUrl, 'Playlist URL', true);
  assertHttpUrlText(settings.epgUrl, 'EPG URL', true);
  assertBoundedString(settings.lastPlayedChannelId, 'Last played channel id', 1024, true);
  assertStringArray(settings.favoriteChannelIds || [], 'Favorite channel ids');
  assertStringArray(settings.recentlyViewedChannelIds || [], 'Recently viewed channel ids');
  const openedReviewIds = settings.openedReviewIds || [];
  assertStringArray(openedReviewIds, 'Opened review ids', 128);
  for (const value of openedReviewIds) {
    assertBoundedString(value, 'Opened review id', 64);
    if (!/^(weekly|monthly|annual):[A-Za-z0-9._-]{1,48}$/.test(value)) {
      throw new TypeError('Opened review id has an invalid format.');
    }
  }
  const dismissedReviewIds = settings.dismissedReviewIds || [];
  assertStringArray(dismissedReviewIds, 'Dismissed review ids', 128);
  for (const value of dismissedReviewIds) {
    assertBoundedString(value, 'Dismissed review id', 64);
    if (!/^(weekly|monthly|annual):[A-Za-z0-9._-]{1,48}$/.test(value)) {
      throw new TypeError('Dismissed review id has an invalid format.');
    }
  }
  if (settings.qualityMappings !== undefined && settings.qualityMappings !== null) {
    assertPlainObject(settings.qualityMappings, 'Quality mappings');
    for (const [key, value] of Object.entries(settings.qualityMappings)) {
      assertBoundedString(key, 'Quality mapping key', 64);
      assertBoundedString(value, 'Quality mapping value', 2048);
    }
  }
  if (settings.discordClientId) {
    assertBoundedString(settings.discordClientId, 'Discord client id', 32);
    if (!/^\d+$/.test(settings.discordClientId)) throw new TypeError('Discord client id must contain only digits.');
  }
  if (settings.appearance !== undefined && !['system', 'light', 'dark'].includes(settings.appearance)) {
    throw new TypeError('Appearance must be system, light, or dark.');
  }
  if (settings.language !== undefined && !['system', 'pt-PT', 'en'].includes(settings.language)) {
    throw new TypeError('Language must be system, pt-PT, or en.');
  }
  if (settings.volume !== undefined && (!Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 100)) {
    throw new TypeError('Volume must be between 0 and 100.');
  }
  for (const key of ['discordRpcEnabled', 'discordShowChannel', 'discordShowProgram', 'discordShowArtwork']) {
    if (settings[key] !== undefined && typeof settings[key] !== 'boolean') {
      throw new TypeError(`${key} must be a boolean.`);
    }
  }
  assertBoundedString(settings.recordingDirectory, 'Recording directory', 4096, true);
  if (settings.recordingDirectory) assertWritableDirectory(settings.recordingDirectory);
  if (settings.recordingMode !== undefined && settings.recordingMode !== 'source-mkv') {
    throw new TypeError('Recording mode must be source-mkv.');
  }
}

function isTrustedRendererUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    if (!app.isPackaged && process.env.FREAKYIPTV_E2E !== '1') {
      return parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
        parsed.port === '5173';
    }

    if (parsed.protocol !== 'file:') return false;
    return path.resolve(fileURLToPath(parsed)) === path.resolve(__dirname, 'dist', 'index.html');
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeNetworkHostname(hostname).toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function normalizeTrustedLocalMediaUrl(urlText) {
  try {
    const parsed = new URL(urlText);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopbackHostname(parsed.hostname)) {
      return null;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function registerTrustedLocalMediaUrl(urlText) {
  const normalized = normalizeTrustedLocalMediaUrl(urlText);
  if (normalized) TRUSTED_LOCAL_MEDIA_URLS.add(normalized);
  return normalized;
}

function unregisterTrustedLocalMediaUrl(urlText) {
  const normalized = normalizeTrustedLocalMediaUrl(urlText);
  if (normalized) TRUSTED_LOCAL_MEDIA_URLS.delete(normalized);
}

function isTrustedLocalMediaUrl(urlText) {
  const normalized = normalizeTrustedLocalMediaUrl(urlText);
  return Boolean(normalized && TRUSTED_LOCAL_MEDIA_URLS.has(normalized));
}

async function shouldBlockRendererNetworkRequest(details) {
  if (!mainWindow || mainWindow.isDestroyed() || details.webContentsId !== mainWindow.webContents.id) {
    return false;
  }

  if (isTrustedRendererUrl(details.url) || isTrustedLocalMediaUrl(details.url)) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(details.url);
  } catch {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (!app.isPackaged && process.env.FREAKYIPTV_E2E === '1' && isLoopbackHostname(parsed.hostname)) {
    return false;
  }

  try {
    await resolveNetworkTarget(parsed.hostname, false);
    return false;
  } catch (error) {
    console.warn('Blocked renderer network request:', redactUrlForLogs(details.url), error.message || error);
    return true;
  }
}

function assertTrustedIpcSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Rejected IPC from an untrusted webContents.');
  }
  if (!event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Rejected IPC from a non-main frame.');
  }
  if (!isTrustedRendererUrl(event.senderFrame.url)) {
    throw new Error('Rejected IPC from an untrusted renderer URL.');
  }
}

const updateState = {
  status: 'idle',
  target: '',
  version: '',
  notes: '',
  asset: null,
  downloadedPath: '',
  progress: 0,
  message: ''
};

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function getUpdateTarget() {
  if (!app.isPackaged) return '';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis';
  if (process.platform === 'darwin') return 'release-page';
  return '';
}

function getPublicUpdateState() {
  return {
    status: updateState.status,
    target: updateState.target,
    version: updateState.version,
    notes: updateState.notes,
    progress: updateState.progress,
    message: updateState.message
  };
}

function publishUpdateState(nextState) {
  Object.assign(updateState, nextState);
  const state = getPublicUpdateState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-update-status', state);
  }
  return state;
}

function resetUpdateState(target) {
  return publishUpdateState({
    status: 'checking',
    target,
    version: '',
    notes: '',
    asset: null,
    downloadedPath: '',
    progress: 0,
    message: ''
  });
}

function updateFailure(error) {
  console.warn('Manual update failed:', error?.message || error);
  return publishUpdateState({
    status: 'error',
    progress: 0,
    message: 'Unable to check for or download the update. Try again.'
  });
}

async function openReleasePage() {
  await shell.openExternal(GITHUB_RELEASES_URL);
  return true;
}

function getGithubJson(urlText) {
  if (urlText !== GITHUB_LATEST_RELEASE_URL) {
    return Promise.reject(new Error('Unexpected update metadata URL.'));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(urlText, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Freaky-IPTV/${app.getVersion()}`
      },
      timeout: 15_000
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub release lookup returned ${response.statusCode}.`));
        return;
      }

      let bytes = 0;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1024 * 1024) {
          response.destroy(new Error('GitHub release metadata is too large.'));
          return;
        }
        body += chunk;
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('GitHub returned invalid release metadata.'));
        }
      });
    });
    request.once('timeout', () => request.destroy(new Error('GitHub release lookup timed out.')));
    request.once('error', reject);
  });
}

function hashFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function downloadPortableAsset(asset, destinationPath, onProgress) {
  if (!asset || !isTrustedGithubAssetUrl(asset.url) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_UPDATE_DOWNLOAD_BYTES) {
    return Promise.reject(new Error('Invalid portable update asset.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let received = 0;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      fs.rmSync(destinationPath, { force: true });
      reject(error);
    };
    const output = fs.createWriteStream(destinationPath, { flags: 'wx' });
    output.once('error', fail);

    const requestAsset = (urlText, redirectCount = 0) => {
      const trusted = redirectCount === 0
        ? isTrustedGithubAssetUrl(urlText)
        : isTrustedGithubRedirectUrl(urlText);
      if (!trusted || redirectCount > MAX_REDIRECTS) {
        fail(new Error('Blocked an untrusted update download redirect.'));
        return;
      }

      const request = https.get(urlText, {
        headers: { 'User-Agent': `Freaky-IPTV/${app.getVersion()}` },
        timeout: 30_000
      }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            fail(new Error('Update download redirect has no location.'));
            return;
          }
          try {
            requestAsset(new URL(location, urlText).toString(), redirectCount + 1);
          } catch {
            fail(new Error('Update download redirect is invalid.'));
          }
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          fail(new Error(`Update download returned ${response.statusCode}.`));
          return;
        }
        const contentLength = Number(response.headers['content-length'] || 0);
        if (contentLength && contentLength !== asset.size) {
          response.resume();
          fail(new Error('Update download size does not match the release metadata.'));
          return;
        }
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > asset.size || received > MAX_UPDATE_DOWNLOAD_BYTES) {
            response.destroy(new Error('Update download exceeded the expected size.'));
            return;
          }
          onProgress(Math.round((received / asset.size) * 100));
        });
        response.once('error', fail);
        response.pipe(output);
      });
      request.once('timeout', () => request.destroy(new Error('Update download timed out.')));
      request.once('error', fail);
    };

    output.once('finish', () => {
      output.close(async () => {
        try {
          if (received !== asset.size) throw new Error('Update download is incomplete.');
          const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '');
          if (digest && (await hashFileSha256(destinationPath)).toLowerCase() !== digest[1].toLowerCase()) {
            throw new Error('Update download checksum does not match the release metadata.');
          }
          if (!settled) {
            settled = true;
            resolve(destinationPath);
          }
        } catch (error) {
          fail(error);
        }
      });
    });

    requestAsset(asset.url);
  });
}

async function checkForManualUpdate() {
  const target = getUpdateTarget();
  if (!target) {
    return publishUpdateState({
      status: 'unsupported',
      target: '',
      progress: 0,
      message: 'Updates are only available in a packaged application.'
    });
  }

  resetUpdateState(target);
  try {
    if (target === 'release-page') {
      const release = await getGithubJson(GITHUB_LATEST_RELEASE_URL);
      if (!release || release.draft || release.prerelease || compareVersions(release.tag_name, app.getVersion()) <= 0) {
        return publishUpdateState({ status: 'up-to-date', message: 'You already have the latest version.' });
      }
      const version = release.tag_name.replace(/^v/i, '');
      await openReleasePage();
      return publishUpdateState({
        status: 'available',
        version,
        notes: typeof release.body === 'string' ? release.body.slice(0, 16 * 1024) : '',
        message: 'New version found. GitHub Releases were opened in your browser.'
      });
    }

    if (target === 'portable') {
      const release = await getGithubJson(GITHUB_LATEST_RELEASE_URL);
      const candidate = selectReleaseCandidate(release, app.getVersion(), 'portable');
      if (!candidate) {
        return publishUpdateState({ status: 'up-to-date', message: 'You already have the latest version.' });
      }
      return publishUpdateState({
        status: 'available',
        version: candidate.version,
        notes: candidate.notes,
        asset: candidate.asset,
        message: 'Update available.'
      });
    }

    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || compareVersions(version, app.getVersion()) <= 0) {
      return publishUpdateState({ status: 'up-to-date', message: 'You already have the latest version.' });
    }
    return publishUpdateState({
      status: 'available',
      version,
      notes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes.slice(0, 16 * 1024) : '',
      message: 'Update available.'
    });
  } catch (error) {
    return updateFailure(error);
  }
}

async function downloadManualUpdate() {
  if (updateState.target === 'release-page') {
    await openReleasePage();
    return publishUpdateState({ status: 'available', message: 'GitHub Releases were opened in your browser.' });
  }

  if (updateState.status !== 'available' || !updateState.target) {
    return publishUpdateState({ status: 'error', message: 'Check for an update before starting the download.' });
  }

  publishUpdateState({ status: 'downloading', progress: 0, message: 'Downloading the update...' });
  try {
    if (updateState.target === 'portable') {
      const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || '';
      if (!isSafePortableExecutablePath(executablePath) || !updateState.asset) {
        throw new Error('Portable executable path is unavailable.');
      }
      const downloadedPath = path.join(path.dirname(executablePath), `.${updateState.asset.name}.download`);
      fs.rmSync(downloadedPath, { force: true });
      await downloadPortableAsset(updateState.asset, downloadedPath, (progress) => publishUpdateState({ progress }));
      return publishUpdateState({
        status: 'downloaded',
        downloadedPath,
        progress: 100,
        message: 'Update ready to install.'
      });
    }

    await autoUpdater.downloadUpdate();
    return publishUpdateState({ status: 'downloaded', progress: 100, message: 'Update ready to install.' });
  } catch (error) {
    return updateFailure(error);
  }
}

function installManualUpdate() {
  if (updateState.target === 'release-page') {
    return publishUpdateState({ status: 'unsupported', message: 'On macOS, download the new version from GitHub Releases.' });
  }
  if (updateState.status !== 'downloaded' || !updateState.target) {
    return publishUpdateState({ status: 'error', message: 'The update is not ready to install yet.' });
  }

  if (updateState.target === 'nsis') {
    publishUpdateState({ status: 'installing', message: 'Restarting to install the update...' });
    autoUpdater.quitAndInstall(false, true);
    return getPublicUpdateState();
  }

  try {
    const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || '';
    const replacement = createPortableReplacementPlan({
      executablePath,
      downloadedPath: updateState.downloadedPath,
      pid: process.pid
    });
    fs.writeFileSync(replacement.scriptPath, Buffer.concat([
      Buffer.from([0xFF, 0xFE]),
      Buffer.from(replacement.script, 'utf16le')
    ]), { mode: 0o600 });
    const helper = spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', replacement.scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    helper.unref();
    publishUpdateState({ status: 'installing', message: 'Restarting to install the update...' });
    app.quit();
    return getPublicUpdateState();
  } catch (error) {
    return updateFailure(error);
  }
}

autoUpdater.on('download-progress', (progress) => {
  if (updateState.target === 'nsis' && updateState.status === 'downloading') {
    publishUpdateState({ progress: Math.round(progress.percent) });
  }
});

autoUpdater.on('error', (error) => {
  if (updateState.target === 'nsis' && ['checking', 'downloading'].includes(updateState.status)) {
    updateFailure(error);
  }
});
function registerTrustedHandle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...args);
  });
}

function registerTrustedOn(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    handler(event, ...args);
  });
}

registerTrustedHandle('get-storage-info', async () => {
  const settingsInfo = getFileStorageInfo(SETTINGS_FILE);
  const cacheInfo = getFileStorageInfo(CACHE_FILE);
  const historyInfo = getFileStorageInfo(HISTORY_FILE);
  const databaseInfo = getFileStorageInfo(DATABASE_FILE);
  let databaseHealth = null;
  try { databaseHealth = await dataStore.storageHealth(); } catch {}

  return {
    dataDir: DATA_DIR,
    settingsFile: SETTINGS_FILE,
    cacheFile: CACHE_FILE,
    historyFile: HISTORY_FILE,
    settingsBytes: settingsInfo.bytes,
    cacheBytes: cacheInfo.bytes,
    historyBytes: historyInfo.bytes,
    cacheUpdatedAtUtc: cacheInfo.updatedAtUtc,
    historyUpdatedAtUtc: historyInfo.updatedAtUtc,
    databaseBytes: databaseInfo.bytes,
    databaseHealth,
    recoveryNotice: dataRecoveryNotice,
    migrationStatus
  };
});

registerTrustedHandle('clear-cache', async () => {
  try {
    await dataStore.clearCache();
    return true;
  } catch (err) {
    console.error('Failed to clear cache:', err);
    return false;
  }
});

registerTrustedHandle('clear-history', async () => {
  try {
    await dataStore.clearHistory();
    return true;
  } catch (err) {
    console.error('Failed to clear watch history:', err);
    return false;
  }
});

const reminderTimers = new Map();
const MAX_REMINDER_TIMEOUT_MS = 0x7fffffff;

function validateReminder(reminder) {
  assertPlainObject(reminder, 'Reminder');
  assertBoundedString(reminder.id, 'Reminder id', 160);
  assertBoundedString(reminder.channelId, 'Reminder channel id', 1024);
  assertBoundedString(reminder.programmeStartUtc, 'Reminder programme start', 64);
  assertBoundedString(reminder.programmeTitle, 'Reminder programme title', 512, true);
  if (![0, 5, 10, 15, 30].includes(reminder.leadMinutes)) throw new TypeError('Invalid reminder lead time.');
  if (!Number.isFinite(new Date(reminder.programmeStartUtc).getTime())) throw new TypeError('Invalid reminder programme start.');
}

function dispatchReminder(reminder) {
  const title = 'Freaky IPTV reminder';
  const body = reminder.programmeTitle || 'A scheduled programme is about to start.';
  let fallbackShown = false;
  const showFallback = () => {
    if (fallbackShown) return;
    fallbackShown = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('reminder-notification', { ...reminder, title, body });
      if (process.platform === 'darwin') app.dock?.bounce('informational');
      else mainWindow.flashFrame(true);
    }
  };
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body });
      notification.once('failed', showFallback);
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('reminder-notification', { ...reminder, title, body, openChannel: true });
        }
      });
      notification.show();
      return;
    }
  } catch {}
  showFallback();
}

function scheduleReminders(reminders) {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();

  for (const reminder of reminders) {
    const programmeStart = new Date(reminder.programmeStartUtc).getTime();
    const leadMinutes = Number(reminder.leadMinutes);
    const dueAt = programmeStart - leadMinutes * 60_000;
    if (!Number.isFinite(programmeStart) || ![0, 5, 10, 15, 30].includes(leadMinutes) || !Number.isFinite(dueAt) || dueAt <= Date.now()) {
      continue;
    }

    const armReminderTimer = () => {
      const remaining = dueAt - Date.now();
      if (remaining <= 0) {
        reminderTimers.delete(reminder.id);
        dispatchReminder(reminder);
        return;
      }

      reminderTimers.set(reminder.id, setTimeout(armReminderTimer, Math.min(remaining, MAX_REMINDER_TIMEOUT_MS)));
    };

    armReminderTimer();
  }
}

registerTrustedHandle('load-reminders', async () => {
  const reminders = await dataStore.loadReminders();
  scheduleReminders(reminders);
  return reminders;
});

registerTrustedHandle('save-reminders', async (event, reminders) => {
  if (!Array.isArray(reminders) || reminders.length > 10000) throw new TypeError('Invalid reminders collection.');
  for (const reminder of reminders) validateReminder(reminder);
  await dataStore.saveReminders(reminders);
  scheduleReminders(reminders);
  return true;
});

function createSafetySnapshot() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(BACKUP_DIR, `pre-import-${stamp}`);
  return createFileSnapshot([SETTINGS_FILE, HISTORY_FILE, DATABASE_FILE], snapshotDir);
}

function restoreSafetySnapshot(snapshotDir) {
  restoreFileSnapshot(snapshotDir);
}

async function pruneSafetySnapshots() {
  const entries = await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true });
  const snapshots = await Promise.all(entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('pre-import-'))
    .map(async entry => ({ entry, stats: await fs.promises.stat(path.join(BACKUP_DIR, entry.name)) })));
  snapshots.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  await Promise.all(snapshots.slice(3)
    .filter(snapshot => snapshot.stats.mtimeMs < cutoff)
    .map(snapshot => fs.promises.rm(path.join(BACKUP_DIR, snapshot.entry.name), { recursive: true, force: true })));
}

registerTrustedHandle('select-recording-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose recordings folder',
    defaultPath: loadSettingsFromFile().recordingDirectory || DEFAULT_RECORDING_DIR,
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return assertWritableDirectory(result.filePaths[0]);
});

registerTrustedHandle('open-recording-directory', async () => {
  const directory = assertWritableDirectory(loadSettingsFromFile().recordingDirectory || DEFAULT_RECORDING_DIR);
  const error = await shell.openPath(directory);
  return error ? { ok: false, error } : { ok: true, path: directory };
});

registerTrustedHandle('get-app-version', () => {
  return app.getVersion();
});
registerTrustedHandle('check-for-updates', () => checkForManualUpdate());
registerTrustedHandle('download-update', () => downloadManualUpdate());
registerTrustedHandle('install-update', () => installManualUpdate());
registerTrustedHandle('open-release-page', () => openReleasePage());

registerTrustedHandle('get-data-directory', () => {
  return DATA_DIR;
});

registerTrustedHandle('open-data-directory', async () => {
  const error = await shell.openPath(DATA_DIR);
  return error ? { ok: false, error } : { ok: true, path: DATA_DIR };
});

registerTrustedHandle('open-external-url', async (event, url) => {
  if (typeof url === 'string' && ALLOWED_EXTERNAL_URLS.has(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

registerTrustedHandle('export-backup', async (event, password) => {
  if (!validateBackupPassword(password)) return { ok: false, error: 'Password must contain at least 10 characters.' };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Freaky IPTV backup',
    defaultPath: path.join(app.getPath('documents'), `FreakyIPTV_${new Date().toISOString().slice(0, 10)}.freakyiptv-backup`),
    filters: [{ name: 'Freaky IPTV Backup', extensions: ['freakyiptv-backup'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    const payload = {
      schemaVersion: 2,
      appVersion: app.getVersion(),
      createdAtUtc: new Date().toISOString(),
      settings: loadSettingsFromFile(),
      history: await dataStore.loadHistory(),
      reminders: await dataStore.loadReminders()
    };
    const envelope = await encryptBackup(payload, password);
    writeJsonAtomic(result.filePath, envelope);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Backup export failed.' };
  }
});

registerTrustedHandle('import-backup', async (event, password) => {
  if (!validateBackupPassword(password)) return { ok: false, error: 'Password must contain at least 10 characters.' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Freaky IPTV backup',
    filters: [{ name: 'Freaky IPTV Backup', extensions: ['freakyiptv-backup'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };

  let snapshotDir = null;
  try {
    const stat = fs.statSync(result.filePaths[0]);
    if (stat.size > 64 * 1024 * 1024) throw new Error('Backup is too large.');
    const envelope = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    const imported = await decryptBackup(envelope, password);
    if (![1, 2].includes(imported.schemaVersion) || !imported.settings || !Array.isArray(imported.history)) throw new Error('Backup could not be opened.');
    const current = { settings: loadSettingsFromFile(), history: await dataStore.loadHistory() };
    const merged = mergeImportedData(current, imported);
    delete merged.settings.preferredStreamMode;
    merged.settings.recordingMode = 'source-mkv';
    const warnings = [];
    if (!fs.existsSync(merged.settings.recordingDirectory || '')) {
      merged.settings.recordingDirectory = DEFAULT_RECORDING_DIR;
      warnings.push('The recording folder from the backup was unavailable. The default folder is being used.');
    }
    validateSettingsPayload(merged.settings);
    assertPayloadSize(merged.history, MAX_HISTORY_PAYLOAD_BYTES, 'Imported history');
    snapshotDir = createSafetySnapshot();
    saveSettingsToFile(merged.settings);
    await dataStore.saveHistory(normalizeHistoryList(merged.history).cleaned);
    if (Array.isArray(merged.reminders)) {
      for (const reminder of merged.reminders) validateReminder(reminder);
      await dataStore.saveReminders(merged.reminders);
      scheduleReminders(merged.reminders);
    }
    await dataStore.clearCache();
    applyDiscordSettings(
      merged.settings.discordRpcEnabled,
      merged.settings.discordShowChannel,
      merged.settings.discordShowProgram,
      merged.settings.discordShowArtwork,
      merged.settings.discordClientId
    );
    return { ok: true, settings: merged.settings, historyCount: merged.history.length, requiresSync: true, warnings };
  } catch (error) {
    if (snapshotDir) restoreSafetySnapshot(snapshotDir);
    return { ok: false, error: 'Backup could not be opened. Check the password and file.' };
  }
});

registerTrustedHandle('capture-playback-frame', async (event, request) => {
  assertPlainObject(request, 'Capture request');
  assertBoundedString(request.channelName, 'Channel name', 256);
  let png;
  if (request.pngDataUrl !== undefined) {
    png = decodePngDataUrl(request.pngDataUrl, MAX_PNG_BYTES);
  } else {
    assertPlainObject(request.bounds, 'Capture bounds');
    const bounds = clampCaptureBounds(request.bounds, mainWindow.getContentBounds());
    const captured = await mainWindow.webContents.capturePage(bounds);
    png = captured.toPNG();
  }
  if (png.length === 0) return { ok: false, error: 'The video frame could not be captured.' };
  let outputPath;
  let diskError = null;
  let clipboardError = null;
  try {
    const directory = assertWritableDirectory(loadSettingsFromFile().recordingDirectory || DEFAULT_RECORDING_DIR);
    outputPath = createUniqueMediaPath(directory, request.channelName, '.png');
    fs.writeFileSync(outputPath, png, { flag: 'wx' });
  } catch (error) {
    diskError = error;
  }
  try {
    clipboard.writeImage(nativeImage.createFromBuffer(png));
  } catch (error) {
    clipboardError = error;
  }
  if (!outputPath && clipboardError) return { ok: false, error: 'The screenshot could not be saved or copied.' };
  return {
    ok: true,
    path: outputPath,
    copiedToClipboard: !clipboardError,
    error: diskError
      ? 'The image was copied to the clipboard, but the file could not be saved.'
      : (clipboardError ? 'The file was saved, but the image could not be copied to the clipboard.' : undefined)
  };
});

registerTrustedHandle('copy-statistics-card', (event, request) => {
  assertPlainObject(request, 'Statistics card request');
  const png = validatePngBuffer(request.pngBytes, MAX_PNG_BYTES);
  clipboard.writeImage(nativeImage.createFromBuffer(png));
  return { ok: true, copiedToClipboard: true };
});

registerTrustedHandle('save-statistics-card', async (event, request) => {
  assertPlainObject(request, 'Statistics card request');
  assertBoundedString(request.suggestedName, 'Statistics card filename', 128);
  const png = validatePngBuffer(request.pngBytes, MAX_PNG_BYTES);
  const baseName = sanitizeFilePart(request.suggestedName || 'FreakyIPTV_Statistics');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save statistics image',
    defaultPath: path.join(app.getPath('pictures'), `${baseName}.png`),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const outputPath = result.filePath.toLowerCase().endsWith('.png') ? result.filePath : `${result.filePath}.png`;
  fs.writeFileSync(outputPath, png);
  return { ok: true, path: outputPath };
});

registerTrustedHandle('copy-text', (event, value) => {
  assertBoundedString(value, 'Clipboard text', 32 * 1024);
  clipboard.writeText(value);
  return true;
});

let recordingProcess = null;
let recordingStopPromise = null;
let recordingRelayId = null;
let recordingState = { status: 'idle', mode: null, path: null, startedAtUtc: null, bytes: 0, error: null };
const recordingIndex = new Map();
const recordingThumbnailTasks = new Map();
let recordingPlaybackServer = null;

function publicRecordingState() {
  const { path: _path, ...safeState } = recordingState;
  return safeState;
}

function emitRecordingState(patch = {}) {
  recordingState = { ...recordingState, ...patch };
  if (recordingState.path && fs.existsSync(recordingState.path)) {
    recordingState.bytes = fs.statSync(recordingState.path).size;
  }
  const safeState = publicRecordingState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('recording-state-changed', safeState);
  return safeState;
}

function resolveFfmpegPath() {
  try {
    const bundled = require('ffmpeg-static');
    const unpacked = bundled.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
    if (fs.existsSync(bundled)) return bundled;
  } catch {}
  return 'ffmpeg';
}

async function stopSourceRecording() {
  if (recordingStopPromise) return recordingStopPromise;
  if (!recordingProcess) {
    if (recordingState.status === 'recording' && recordingState.mode === 'source-mkv') {
      return emitRecordingState({ status: 'completed', error: null });
    }
    return recordingState;
  }
  const proc = recordingProcess;
  emitRecordingState({ status: 'finalizing' });
  recordingStopPromise = new Promise(resolve => {
    let settled = false;
    let forced = false;
    const finish = (code = 0) => {
      if (settled) return;
      settled = true;
      recordingProcess = null;
      recordingStopPromise = null;
      recordingRelayId = null;
      const failed = forced || (code !== 0 && code !== null);
      resolve(emitRecordingState(failed
        ? { status: 'failed', error: 'FFmpeg could not finalize the recording. The partial file was preserved.' }
        : { status: 'completed', error: null }));
    };
    proc.once('exit', finish);
    try { proc.stdin.write('q\n'); } catch {}
    setTimeout(() => {
      if (!settled && !proc.killed) {
        forced = true;
        proc.kill();
      }
      finish(null);
    }, 4000);
  });
  return recordingStopPromise;
}

registerTrustedHandle('start-source-recording', async (event, request) => {
  assertPlainObject(request, 'Recording request');
  assertBoundedString(request.sourceUrl, 'Recording source URL', MAX_URL_LENGTH);
  assertHttpUrlText(request.sourceUrl, 'Recording source URL');
  assertBoundedString(request.channelName, 'Channel name', 256);
  if (request.relayId !== undefined) assertBoundedString(request.relayId, 'Playback relay id', 64, true);
  if (recordingProcess || recordingStopPromise) return { ok: false, error: 'A recording is already active.' };
  const directory = assertWritableDirectory(loadSettingsFromFile().recordingDirectory || DEFAULT_RECORDING_DIR);
  const outputPath = createUniqueMediaPath(directory, request.channelName, '.mkv');
  // Prefer the player relay: some IPTV providers allow one connection per
  // account. The relay remains alive after recording finalisation, so the
  // player never receives a spurious ended event.
  const relay = request.relayId ? playbackRelays.get(request.relayId) : null;
  const recordingInputUrl = relay ? `${relay.url}?consumer=recording` : request.sourceUrl;
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-user_agent', 'VLC/3.0.18 LibVLC/3.0.18',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
    '-i', recordingInputUrl, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-sn', '-dn', '-f', 'matroska', outputPath
  ];
  const proc = spawn(resolveFfmpegPath(), args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  recordingProcess = proc;
  recordingRelayId = relay ? relay.id : null;
  let errorText = '';
  proc.stderr.on('data', chunk => { errorText = `${errorText}${chunk}`.slice(-4096); });
  proc.once('error', error => {
    if (recordingProcess === proc) recordingProcess = null;
    recordingStopPromise = null;
    recordingRelayId = null;
    emitRecordingState({ status: 'failed', error: error.message, path: outputPath });
  });
  proc.once('exit', code => {
    if (recordingProcess === proc) recordingProcess = null;
    recordingRelayId = null;
    if (recordingState.status === 'finalizing') return;
    if (code === 0) {
      emitRecordingState({ status: 'completed', error: null });
    } else {
      emitRecordingState({ status: 'failed', error: errorText || `FFmpeg exited with code ${code}.` });
    }
  });
  emitRecordingState({ status: 'recording', mode: 'source-mkv', path: outputPath, startedAtUtc: new Date().toISOString(), bytes: 0, error: null });
  return { ok: true, state: recordingState };
});

registerTrustedHandle('stop-source-recording', () => stopSourceRecording());

registerTrustedHandle('get-recording-state', () => emitRecordingState());

async function scanRecordings() {
  const root = assertWritableDirectory(loadSettingsFromFile().recordingDirectory || DEFAULT_RECORDING_DIR);
  const results = [];
  const visit = async directory => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mkv')) {
        const stats = await fs.promises.stat(absolutePath);
        const relativePath = path.relative(root, absolutePath);
        const id = crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 32);
        recordingIndex.set(id, {
          id,
          root,
          absolutePath,
          relativePath,
          bytes: stats.size,
          modifiedAtUtc: stats.mtime.toISOString()
        });
        results.push({ id, name: entry.name, bytes: stats.size, modifiedAtUtc: stats.mtime.toISOString(), status: 'ready' });
      }
    }
  };
  recordingIndex.clear();
  await visit(root);
  results.sort((a, b) => b.modifiedAtUtc.localeCompare(a.modifiedAtUtc));
  await dataStore.setRecordings(results);
  return results;
}

function resolveRecordingId(id) {
  assertBoundedString(id, 'Recording id', 64);
  const entry = recordingIndex.get(id);
  if (!entry || !fs.existsSync(entry.absolutePath)) throw new Error('Recording was not found. Scan the library again.');
  return entry;
}

function recordingThumbnailCachePath(entry) {
  const cacheKey = crypto.createHash('sha256')
    .update(`${entry.id}:${entry.bytes}:${entry.modifiedAtUtc}`)
    .digest('hex');
  return path.join(RECORDING_THUMBNAIL_DIR, `${cacheKey}.jpg`);
}

function extractRecordingThumbnail(entry) {
  const run = (seekSeconds) => new Promise((resolve, reject) => {
    const process = spawn(resolveFfmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-ss', seekSeconds, '-i', entry.absolutePath,
      '-map', '0:v:0?', '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5',
      '-an', '-sn', '-dn', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    process.stdout.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_RECORDING_THUMBNAIL_BYTES) {
        try { process.kill(); } catch {}
        fail(new Error('Recording thumbnail exceeded its size limit.'));
        return;
      }
      chunks.push(chunk);
    });
    process.once('error', fail);
    process.once('exit', code => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error('FFmpeg could not extract a recording thumbnail.'));
        return;
      }
      const image = Buffer.concat(chunks);
      if (image.length === 0) {
        fail(new Error('Recording does not contain a decodable video frame.'));
        return;
      }
      settled = true;
      resolve(image);
    });
  });

  return (async () => {
    let lastError = null;
    for (const seekSeconds of ['2', '0']) {
      try {
        return await run(seekSeconds);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('FFmpeg could not extract a recording thumbnail.');
  })();
}

async function loadRecordingThumbnail(entry) {
  const cachePath = recordingThumbnailCachePath(entry);
  try {
    const cached = await fs.promises.readFile(cachePath);
    if (cached.length > 0 && cached.length <= MAX_RECORDING_THUMBNAIL_BYTES) return cached;
  } catch {}

  let task = recordingThumbnailTasks.get(cachePath);
  if (!task) {
    task = extractRecordingThumbnail(entry);
    recordingThumbnailTasks.set(cachePath, task);
    const clearTask = () => {
      if (recordingThumbnailTasks.get(cachePath) === task) recordingThumbnailTasks.delete(cachePath);
    };
    task.then(clearTask, clearTask);
  }
  const image = await task;
  await fs.promises.writeFile(cachePath, image, { flag: 'w' });
  return image;
}

registerTrustedHandle('list-recordings', () => scanRecordings());
registerTrustedHandle('get-recording-playback-url', async (event, id) => {
  // Refresh the index if the library page has not scanned during this process.
  if (!recordingIndex.has(id)) await scanRecordings();
  resolveRecordingId(id);
  return { ok: true, url: `freaky-recording://${encodeURIComponent(id)}` };
});
registerTrustedHandle('get-recording-thumbnail', async (event, id) => {
  try {
    if (!recordingIndex.has(id)) await scanRecordings();
    const entry = resolveRecordingId(id);
    const image = await loadRecordingThumbnail(entry);
    return { ok: true, dataUrl: `data:image/jpeg;base64,${image.toString('base64')}` };
  } catch (error) {
    console.warn('Failed to generate recording thumbnail:', error?.message || error);
    return { ok: false, error: 'Unable to generate a preview for this recording.' };
  }
});

function stopRecordingPlaybackProxy() {
  if (!recordingPlaybackServer) return;
  const server = recordingPlaybackServer;
  recordingPlaybackServer = null;
  if (server.freakyIptvTrustedUrl) unregisterTrustedLocalMediaUrl(server.freakyIptvTrustedUrl);
  try { server.close(); } catch {}
}

function startRecordingPlaybackProxy(entry) {
  stopRecordingPlaybackProxy();
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      if (request.method === 'OPTIONS') {
        writeCorsHeaders(response, { statusCode: 204 });
        response.end();
        return;
      }
      if (request.method !== 'GET') {
        writeCorsHeaders(response, { statusCode: 405 });
        response.end();
        return;
      }

      // Chromium cannot decode every MKV codec. Transcode only this local
      // playback request to fragmented MP4, preserving safe renderer isolation.
      const process = spawn(resolveFfmpegPath(), [
        '-hide_banner', '-loglevel', 'warning', '-i', entry.absolutePath,
        '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-c:a', getPreferredAacEncoder(), '-movflags',
        '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let headersSent = false;
      const beginResponse = () => {
        if (headersSent) return;
        headersSent = true;
        writeCorsHeaders(response, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' } });
      };
      process.stdout.on('data', chunk => {
        beginResponse();
        if (!response.write(chunk)) process.stdout.pause(), response.once('drain', () => process.stdout.resume());
      });
      process.once('error', () => {
        if (!headersSent) writeCorsHeaders(response, { statusCode: 500 });
        response.end();
      });
      process.once('exit', () => { if (!response.writableEnded) response.end(); });
      request.once('close', () => { if (!process.killed) process.kill(); });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not start the recording playback service.'));
        return;
      }
      recordingPlaybackServer = server;
      const url = `http://127.0.0.1:${address.port}/recording.mp4`;
      server.freakyIptvTrustedUrl = url;
      registerTrustedLocalMediaUrl(url);
      resolve(url);
    });
  });
}

registerTrustedHandle('start-recording-playback', async (event, id) => {
  try {
    if (!recordingIndex.has(id)) await scanRecordings();
    const entry = resolveRecordingId(id);
    return { ok: true, url: await startRecordingPlaybackProxy(entry) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not transcode recording for playback.' };
  }
});
registerTrustedHandle('rename-recording', async (event, request) => {
  assertPlainObject(request, 'Recording rename request');
  const entry = resolveRecordingId(request.id);
  assertBoundedString(request.name, 'Recording name', 256);
  const requested = request.name.trim().replace(/\.mkv$/i, '');
  const destination = path.join(path.dirname(entry.absolutePath), `${sanitizeFilePart(requested)}.mkv`);
  if (destination === entry.absolutePath) return { ok: true };
  if (fs.existsSync(destination)) return { ok: false, error: 'A recording with that name already exists.' };
  const relativeDestination = path.relative(entry.root, destination);
  if (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) throw new Error('Invalid recording destination.');
  await fs.promises.rename(entry.absolutePath, destination);
  return { ok: true };
});
registerTrustedHandle('delete-recording', async (event, id) => {
  const entry = resolveRecordingId(id);
  await shell.trashItem(entry.absolutePath);
  recordingIndex.delete(id);
  return { ok: true };
});

function getDiagnosticReport() {
  return {
    schemaVersion: 1,
    exportedAtUtc: new Date().toISOString(),
    app: { version: app.getVersion(), platform: process.platform, electron: process.versions.electron, node: process.versions.node },
    storage: { database: dataRecoveryNotice ? 'recovered' : 'healthy', recoveryNotice: dataRecoveryNotice?.message || null },
    playback: { engines: ['native', 'hls', 'mpegts', 'proxy-copy', 'proxy-hardware'], recording: publicRecordingState().status },
    privacy: { urlsIncluded: false, tokensIncluded: false, namesIncluded: false },
    notifications: { nativeSupported: Notification.isSupported() },
    casting: { available: false, reason: 'Casting adapters are not installed in this build.' }
  };
}

registerTrustedHandle('get-diagnostics', async () => ({ ...getDiagnosticReport(), database: await dataStore.storageHealth() }));
registerTrustedHandle('export-diagnostics', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export diagnostics',
    defaultPath: path.join(app.getPath('documents'), `freaky-diagnostics-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const report = { ...getDiagnosticReport(), database: await dataStore.storageHealth() };
  await fs.promises.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
  return { ok: true };
});

function parseRawHttpHeaders(headerText) {
  const lines = headerText.split(/\r?\n/);
  const statusMatch = lines[0]?.match(/^HTTP\/\d\.\d\s+(\d+)/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const headers = {};

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) continue;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;

    if (headers[key]) {
      headers[key] = `${headers[key]}\n${value}`;
    } else {
      headers[key] = value;
    }
  }

  return { statusCode, headers };
}

function firstHeaderValue(headers, name) {
  return (headers[name] || '').split('\n')[0].trim();
}

function normalizeNetworkHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateIpv4Address(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function mappedIpv4FromIpv6(address) {
  const lower = address.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  const suffix = lower.slice(7);
  if (suffix.includes('.')) return suffix;
  const parts = suffix.split(':');
  if (parts.length !== 2) return null;
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateNetworkAddress(address) {
  const normalized = address.split('%')[0].toLowerCase();
  if (net.isIP(normalized) === 4) return isPrivateIpv4Address(normalized);
  if (net.isIP(normalized) !== 6) return true;

  const mappedIpv4 = mappedIpv4FromIpv6(normalized);
  if (mappedIpv4) return isPrivateIpv4Address(mappedIpv4);
  if (normalized === '::' || normalized === '::1') return true;

  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    normalized.startsWith('2001:db8:');
}

function assertAllowedNetworkTarget(hostname, allowPrivateNetwork) {
  const normalized = normalizeNetworkHostname(hostname);
  if (!allowPrivateNetwork && net.isIP(normalized) && isPrivateNetworkAddress(normalized)) {
    throw new Error('Private and local network destinations are blocked.');
  }
  return normalized;
}

async function resolveNetworkTarget(hostname, allowPrivateNetwork = false) {
  const normalized = assertAllowedNetworkTarget(hostname, allowPrivateNetwork);
  const cacheKey = `${allowPrivateNetwork ? 'lan' : 'public'}:${normalized}`;
  const cached = networkDnsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) throw new Error(cached.error);
    return cached.result;
  }
  try {
    const addresses = await dns.promises.lookup(normalized, { all: true, verbatim: true });
    if (addresses.length === 0) throw new Error('The destination host did not resolve.');
    if (!allowPrivateNetwork && addresses.some(entry => isPrivateNetworkAddress(entry.address))) {
      throw new Error('Private and local network destinations are blocked.');
    }
    const result = { hostname: normalized, ...addresses[0] };
    networkDnsCache.set(cacheKey, { result, expiresAt: Date.now() + DNS_CACHE_SUCCESS_TTL_MS });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The destination host did not resolve.';
    networkDnsCache.set(cacheKey, { error: message, expiresAt: Date.now() + DNS_CACHE_FAILURE_TTL_MS });
    throw error;
  }
}

function createGuardedLookup(allowPrivateNetwork) {
  return (hostname, options, callback) => {
    resolveNetworkTarget(hostname, allowPrivateNetwork)
      .then(result => {
        if (typeof options === 'object' && options?.all) {
          callback(null, [{ address: result.address, family: result.family }]);
          return;
        }
        callback(null, result.address, result.family);
      })
      .catch(callback);
  };
}

function redactUrlForLogs(urlText) {
  try {
    const parsed = new URL(urlText);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return '[redacted-url]';
  }
}

function requestRawUrl(urlText, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlText);
    } catch {
      reject(new Error('Invalid URL.'));
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      reject(new Error('Unsupported URL protocol.'));
      return;
    }

    const allowPrivateNetwork = false;
    let networkHostname;
    try {
      networkHostname = assertAllowedNetworkTarget(parsedUrl.hostname, allowPrivateNetwork);
    } catch (error) {
      reject(error);
      return;
    }
    const isHttps = parsedUrl.protocol === 'https:';
    const port = Number(parsedUrl.port || (isHttps ? 443 : 80));
    const requestPath = `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`;
    const hostHeader = parsedUrl.port ? `${parsedUrl.hostname}:${parsedUrl.port}` : parsedUrl.hostname;
    const connectionOptions = {
      host: networkHostname,
      port,
      lookup: createGuardedLookup(allowPrivateNetwork)
    };
    const socket = isHttps
      ? tls.connect({
        ...connectionOptions,
        servername: net.isIP(networkHostname) ? undefined : networkHostname
      })
      : net.createConnection(connectionOptions);

    let headerBuffer = Buffer.alloc(0);
    const bodyChunks = [];
    let headersParsed = false;
    let responseMeta = null;
    let bodyBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const sendRequest = () => {
      socket.write(
        `GET ${requestPath} HTTP/1.1\r\n` +
        `Host: ${hostHeader}\r\n` +
        `User-Agent: FreakyIPTV/1.0\r\n` +
        `Accept: */*\r\n` +
        `Connection: close\r\n\r\n`
      );
    };

    const appendBody = (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_TEXT_DOWNLOAD_BYTES) {
        fail(new Error('Downloaded response is too large.'));
        return;
      }
      bodyChunks.push(chunk);
    };

    socket.setTimeout(60000);
    socket.once(isHttps ? 'secureConnect' : 'connect', sendRequest);
    socket.on('timeout', () => fail(new Error('Timed out downloading URL.')));
    socket.on('error', (error) => fail(error));

    socket.on('data', (chunk) => {
      if (settled) return;

      if (headersParsed) {
        appendBody(chunk);
        return;
      }

      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const headerEnd = headerBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (headerBuffer.length > 64 * 1024) {
          fail(new Error('Response headers are too large.'));
        }
        return;
      }

      const headerText = headerBuffer.subarray(0, headerEnd).toString('latin1');
      responseMeta = parseRawHttpHeaders(headerText);
      headersParsed = true;

      const location = firstHeaderValue(responseMeta.headers, 'location');
      if (responseMeta.statusCode >= 300 && responseMeta.statusCode < 400 && location) {
        if (redirectCount >= MAX_REDIRECTS) {
          fail(new Error('Too many redirects.'));
          return;
        }

        settled = true;
        socket.destroy();
        resolve(requestRawUrl(new URL(location, parsedUrl).toString(), redirectCount + 1));
        return;
      }

      const body = headerBuffer.subarray(headerEnd + 4);
      if (body.length > 0) {
        appendBody(body);
      }
    });

    socket.on('end', () => {
      if (settled) return;
      settled = true;

      if (!responseMeta) {
        reject(new Error('No HTTP response received.'));
        return;
      }

      resolve({
        statusCode: responseMeta.statusCode,
        headers: responseMeta.headers,
        body: Buffer.concat(bodyChunks, bodyBytes),
        finalUrl: urlText
      });
    });
  });
}

function inflateBuffer(buffer, method) {
  return new Promise((resolve, reject) => {
    try {
      method(buffer, { maxOutputLength: MAX_DECOMPRESSED_TEXT_BYTES }, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function decodeResponseBody(response) {
  const encoding = firstHeaderValue(response.headers, 'content-encoding').toLowerCase();
  const looksGzipped = response.body.length >= 2 && response.body[0] === 0x1f && response.body[1] === 0x8b;

  if (encoding.includes('br')) {
    return inflateBuffer(response.body, zlib.brotliDecompress);
  }

  if (encoding.includes('gzip') || looksGzipped) {
    return inflateBuffer(response.body, zlib.gunzip);
  }

  if (encoding.includes('deflate')) {
    return inflateBuffer(response.body, zlib.inflate);
  }

  return response.body;
}

async function downloadUrlText(url) {
  const response = await requestHttpUrl(url);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Failed to download URL. HTTP status: ${response.statusCode}`);
  }

  const decoded = await decodeResponseBody(response);
  return decoded.toString('utf8');
}

async function requestHttpUrl(urlText, redirectCount = 0) {
  let parsedUrl;
  try {
    parsedUrl = new URL(urlText);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported URL protocol.');

  // Resolve before connecting and return that exact address from lookup. This
  // prevents a hostname from being re-resolved to a private address later.
  const target = await resolveNetworkTarget(parsedUrl.hostname, false);
  const transport = parsedUrl.protocol === 'https:' ? https : http;
  const basicAuth = parsedUrl.username
    ? `Basic ${Buffer.from(`${decodeURIComponent(parsedUrl.username)}:${decodeURIComponent(parsedUrl.password)}`).toString('base64')}`
    : null;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method: 'GET',
      headers: {
        'User-Agent': 'FreakyIPTV/1.0',
        Accept: '*/*',
        ...(basicAuth ? { Authorization: basicAuth } : {})
      },
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options?.all) {
          callback(null, [{ address: target.address, family: target.family }]);
          return;
        }
        callback(null, target.address, target.family);
      }
    }, response => {
      const statusCode = response.statusCode || 0;
      const location = typeof response.headers.location === 'string' ? response.headers.location : undefined;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects.'));
          return;
        }
        const nextUrl = new URL(location, parsedUrl);
        // HTTP credentials are scoped to one origin and must never follow a
        // cross-origin redirect.
        if (nextUrl.origin !== parsedUrl.origin) {
          nextUrl.username = '';
          nextUrl.password = '';
        }
        resolve(requestHttpUrl(nextUrl.toString(), redirectCount + 1));
        return;
      }

      const chunks = [];
      let byteLength = 0;
      response.on('data', chunk => {
        byteLength += chunk.length;
        if (byteLength > MAX_TEXT_DOWNLOAD_BYTES) {
          request.destroy(new Error('Downloaded response is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks, byteLength),
        finalUrl: parsedUrl.toString()
      }));
      response.on('error', reject);
    });
    request.setTimeout(60_000, () => request.destroy(new Error('Timed out downloading URL.')));
    request.on('error', reject);
    request.end();
  });
}

registerTrustedHandle('download-url-text', async (event, url) => {
  assertBoundedString(url, 'Download URL', MAX_URL_LENGTH);
  return downloadUrlText(url);
});

let vlcProxyProcess = null;
let upstreamRelayServer = null;
let vlcOutputRelayServer = null;
let ffmpegEncoderList = null;
let proxyBytesDownloaded = 0;
let playbackRelaySequence = 0;
const playbackRelays = new Map();
const playbackRelayBySourceUrl = new Map();
const PLAYBACK_RELAY_IDLE_MS = 5000;
const PLAYBACK_RELAY_REPLAY_BYTES = 8 * 1024 * 1024;
const PLAYBACK_RELAY_RECONNECT_DELAY_MS = 250;
const PLAYBACK_RELAY_UPSTREAM_TIMEOUT_MS = 8000;

function relayId() {
  playbackRelaySequence += 1;
  return `relay-${Date.now().toString(36)}-${playbackRelaySequence.toString(36)}`;
}

function closePlaybackRelay(relay) {
  if (!relay || relay.closed) return;
  relay.closed = true;
  if (relay.url) unregisterTrustedLocalMediaUrl(relay.url);
  if (relay.idleTimer) {
    clearTimeout(relay.idleTimer);
    relay.idleTimer = null;
  }
  if (relay.reconnectTimer) {
    clearTimeout(relay.reconnectTimer);
    relay.reconnectTimer = null;
  }
  for (const client of relay.clients) {
    try {
      if (!client.response.writableEnded) client.response.end();
    } catch {}
  }
  relay.clients.clear();
  if (relay.upstreamResponse) {
    try { relay.upstreamResponse.destroy(); } catch {}
    relay.upstreamResponse = null;
  }
  if (relay.server) {
    try { relay.server.close(); } catch {}
  }
  playbackRelays.delete(relay.id);
  if (playbackRelayBySourceUrl.get(relay.sourceUrl) === relay.id) {
    playbackRelayBySourceUrl.delete(relay.sourceUrl);
  }
}

function stopPlaybackRelay(id) {
  const relay = playbackRelays.get(id);
  if (!relay) return true;
  if (recordingRelayId === id && recordingProcess) {
    relay.playbackReleased = true;
    return true;
  }
  closePlaybackRelay(relay);
  return true;
}

function schedulePlaybackRelayIdleCheck(relay) {
  if (relay.closed || relay.clients.size > 0 || recordingRelayId === relay.id) return;
  if (relay.idleTimer) clearTimeout(relay.idleTimer);
  relay.idleTimer = setTimeout(() => {
    relay.idleTimer = null;
    if (!relay.closed && relay.clients.size === 0 && recordingRelayId !== relay.id && relay.playbackReleased) {
      closePlaybackRelay(relay);
    } else if (!relay.closed && relay.clients.size === 0 && relay.upstreamResponse) {
      try { relay.upstreamResponse.destroy(); } catch {}
      relay.upstreamResponse = null;
      relay.connecting = false;
    }
  }, PLAYBACK_RELAY_IDLE_MS);
}

function appendPlaybackRelayReplay(relay, chunk) {
  if (!chunk || chunk.length === 0) return;
  relay.replayChunks.push(chunk);
  relay.replayBytes += chunk.length;
  while (relay.replayBytes > PLAYBACK_RELAY_REPLAY_BYTES && relay.replayChunks.length > 0) {
    const removed = relay.replayChunks.shift();
    relay.replayBytes -= removed.length;
  }
}

function writePlaybackRelayReplay(relay, client) {
  if (!client.needsReplay) return;
  client.needsReplay = false;
  for (const replayChunk of relay.replayChunks) {
    if (client.closed || client.response.writableEnded) return;
    client.response.write(replayChunk);
  }
}

function sendPlaybackRelayHeaders(relay, client) {
  if (client.closed || client.headersSent || !relay.headersReady) return;
  writeCorsHeaders(client.response, {
    statusCode: relay.statusCode >= 200 && relay.statusCode < 400 ? 200 : relay.statusCode,
    headers: {
      'Content-Type': relay.contentType || 'video/MP2T',
      'Cache-Control': 'no-cache'
    }
  });
  client.headersSent = true;
  writePlaybackRelayReplay(relay, client);
}

function broadcastPlaybackRelayChunk(relay, chunk) {
  if (relay.clients.size === 0) return;
  let pendingDrains = 0;
  const resumeIfReady = () => {
    pendingDrains -= 1;
    if (pendingDrains <= 0 && relay.upstreamResponse && !relay.upstreamResponse.destroyed) {
      relay.upstreamResponse.resume();
    }
  };

  for (const client of relay.clients) {
    if (client.closed) continue;
    sendPlaybackRelayHeaders(relay, client);
    if (!client.headersSent || client.response.writableEnded) continue;
    if (!client.response.write(chunk)) {
      if (client.ignoreBackpressure) continue;
      pendingDrains += 1;
      client.response.once('drain', resumeIfReady);
    }
  }

  if (pendingDrains > 0 && relay.upstreamResponse) {
    relay.upstreamResponse.pause();
  }
}

function endPlaybackRelayClients(relay) {
  for (const client of relay.clients) {
    try {
      if (!client.response.writableEnded) client.response.end();
    } catch {}
  }
  relay.clients.clear();
  schedulePlaybackRelayIdleCheck(relay);
}

function schedulePlaybackRelayReconnect(relay) {
  if (relay.closed || relay.reconnectTimer) return;
  if (relay.clients.size === 0 && recordingRelayId !== relay.id) {
    schedulePlaybackRelayIdleCheck(relay);
    return;
  }
  relay.reconnectTimer = setTimeout(() => {
    relay.reconnectTimer = null;
    startPlaybackRelayUpstream(relay);
  }, PLAYBACK_RELAY_RECONNECT_DELAY_MS);
}

function startPlaybackRelayUpstream(relay, currentUrl = relay.sourceUrl) {
  if (relay.closed || relay.connecting || relay.upstreamResponse) return;
  relay.connecting = true;
  openStreamingHttpRequest(currentUrl, {
    allowPrivateNetwork: false,
    maxRedirects: MAX_REDIRECTS,
    resolveTarget: resolveNetworkTarget,
    // FFmpeg gives up on the local stream after ten seconds. Reconnect the
    // remote source first so consumers never need to restart that local URL.
    timeoutMs: PLAYBACK_RELAY_UPSTREAM_TIMEOUT_MS
  }).then(response => {
    if (relay.closed) {
      response.destroy();
      return;
    }
    relay.upstreamResponse = response;
    relay.statusCode = response.statusCode || 502;
    relay.contentType = response.headers['content-type'] || 'video/MP2T';
    relay.headersReady = true;
    relay.connecting = false;
    relay.lastError = null;
    for (const client of relay.clients) sendPlaybackRelayHeaders(relay, client);

    let settled = false;
    const reconnect = error => {
      if (settled) return;
      settled = true;
      if (relay.upstreamResponse === response) relay.upstreamResponse = null;
      relay.connecting = false;
      if (error) {
        relay.lastError = error.message || String(error);
        console.warn('Playback relay upstream interrupted:', relay.lastError);
      }
      // A new connection can start at a different transport-stream boundary.
      // Do not prepend stale replay data to late-joining consumers.
      relay.replayChunks = [];
      relay.replayBytes = 0;
      schedulePlaybackRelayReconnect(relay);
    };

    response.on('data', chunk => {
      relay.bytesDownloaded += chunk.length;
      proxyBytesDownloaded = relay.bytesDownloaded;
      appendPlaybackRelayReplay(relay, chunk);
      broadcastPlaybackRelayChunk(relay, chunk);
    });
    response.once('error', reconnect);
    response.once('end', () => reconnect(null));
    response.once('close', () => reconnect(null));
  }).catch(error => {
    relay.lastError = error instanceof Error ? error.message : String(error);
    relay.connecting = false;
    console.warn('Playback relay could not open upstream:', relay.lastError);
    schedulePlaybackRelayReconnect(relay);
  });
}

function startPlaybackRelayServer(sourceUrl) {
  const existingId = playbackRelayBySourceUrl.get(sourceUrl);
  const existing = existingId ? playbackRelays.get(existingId) : null;
  if (existing && !existing.closed) return Promise.resolve(existing);

  const relay = {
    id: relayId(),
    sourceUrl,
    url: null,
    server: null,
    clients: new Set(),
    upstreamResponse: null,
    connecting: false,
    headersReady: false,
    statusCode: 200,
    contentType: 'video/MP2T',
    bytesDownloaded: 0,
    replayChunks: [],
    replayBytes: 0,
    lastError: null,
    idleTimer: null,
    reconnectTimer: null,
    playbackReleased: false,
    closed: false
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((clientReq, clientRes) => {
      if (clientReq.method === 'OPTIONS') {
        writeCorsHeaders(clientRes, { statusCode: 204 });
        clientRes.end();
        return;
      }

      if (clientReq.method !== 'GET') {
        writeCorsHeaders(clientRes, { statusCode: 405 });
        clientRes.end('Method not allowed');
        return;
      }

      if (relay.idleTimer) {
        clearTimeout(relay.idleTimer);
        relay.idleTimer = null;
      }

      let isRecordingClient = false;
      try {
        isRecordingClient = new URL(clientReq.url || '/', relay.url || 'http://127.0.0.1/').searchParams.get('consumer') === 'recording';
      } catch {}
      const client = { response: clientRes, headersSent: false, closed: false, needsReplay: relay.headersReady, ignoreBackpressure: isRecordingClient };
      relay.clients.add(client);
      sendPlaybackRelayHeaders(relay, client);
      startPlaybackRelayUpstream(relay);

      clientRes.once('close', () => {
        client.closed = true;
        relay.clients.delete(client);
        schedulePlaybackRelayIdleCheck(relay);
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        server.close();
        reject(new Error('Could not start playback relay.'));
        return;
      }
      relay.server = server;
      relay.url = `http://127.0.0.1:${address.port}/source`;
      registerTrustedLocalMediaUrl(relay.url);
      playbackRelays.set(relay.id, relay);
      playbackRelayBySourceUrl.set(sourceUrl, relay.id);
      resolve(relay);
    });
  });
}

function getFfmpegEncoderList() {
  if (ffmpegEncoderList !== null) {
    return ffmpegEncoderList;
  }

  try {
    const result = spawnSync(resolveFfmpegPath(), ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    });
    ffmpegEncoderList = `${result.stdout || ''}\n${result.stderr || ''}`;
  } catch (e) {
    console.warn('Failed to detect FFmpeg encoders:', e);
    ffmpegEncoderList = '';
  }

  return ffmpegEncoderList;
}

function hasFfmpegEncoder(name) {
  return new RegExp(`\\b${name}\\b`).test(getFfmpegEncoderList());
}

function getPreferredAacEncoder() {
  return process.platform === 'win32' && hasFfmpegEncoder('aac_mf') ? 'aac_mf' : 'aac';
}

function findLibVlcProxyHelperPath() {
  const executableName = process.platform === 'win32' ? 'LibVlcProxyHelper.exe' : 'LibVlcProxyHelper';
  const candidates = [
    getNativeRuntimePath('libvlc-proxy', executableName),
    path.join(__dirname, 'libvlc-proxy-helper', 'bin', 'Release', 'net8.0-windows10.0.17763.0', 'win-x64', 'publish', 'LibVlcProxyHelper.exe'),
    path.join(__dirname, 'libvlc-proxy-helper', 'bin', 'Release', 'net8.0-windows10.0.17763.0', 'LibVlcProxyHelper.exe'),
    path.join(__dirname, 'libvlc-proxy-helper', 'bin', 'Debug', 'net8.0-windows10.0.17763.0', 'LibVlcProxyHelper.exe')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function stopVlcProxyProcess() {
  if (vlcOutputRelayServer) {
    const server = vlcOutputRelayServer;
    vlcOutputRelayServer = null;
    if (server.freakyIptvTrustedUrl) unregisterTrustedLocalMediaUrl(server.freakyIptvTrustedUrl);
    try {
      server.close();
    } catch (e) {
      console.warn('Failed to stop VLC output relay:', e);
    }
  }

  if (upstreamRelayServer) {
    const server = upstreamRelayServer;
    upstreamRelayServer = null;
    if (server.freakyIptvTrustedUrl) unregisterTrustedLocalMediaUrl(server.freakyIptvTrustedUrl);
    try {
      server.close();
    } catch (e) {
      console.warn('Failed to stop upstream stream relay:', e);
    }
  }

  if (!vlcProxyProcess) return;

  const proc = vlcProxyProcess;
  vlcProxyProcess = null;

  try {
    if (!proc.killed) {
      proc.kill();
    }
  } catch (e) {
    console.warn('Failed to stop VLC proxy:', e);
  }
}

function startUpstreamRelay(sourceUrl) {
  proxyBytesDownloaded = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((clientReq, clientRes) => {
      const pipeUrl = (currentUrl, redirectCount = 0) => {
        let upstreamUrl;
        try {
          upstreamUrl = new URL(currentUrl);
        } catch (e) {
          clientRes.writeHead(500);
          clientRes.end('Invalid upstream URL');
          return;
        }

        if (upstreamUrl.protocol !== 'http:' && upstreamUrl.protocol !== 'https:') {
          clientRes.writeHead(502);
          clientRes.end('Unsupported upstream URL protocol');
          return;
        }

        const allowPrivateNetwork = false;
        let networkHostname;
        try {
          networkHostname = assertAllowedNetworkTarget(upstreamUrl.hostname, allowPrivateNetwork);
        } catch (error) {
          clientRes.writeHead(502);
          clientRes.end(error.message);
          return;
        }

        const isHttps = upstreamUrl.protocol === 'https:';
        const port = Number(upstreamUrl.port || (isHttps ? 443 : 80));
        const requestPath = `${upstreamUrl.pathname || '/'}${upstreamUrl.search || ''}`;
        const hostHeader = upstreamUrl.port ? `${upstreamUrl.hostname}:${upstreamUrl.port}` : upstreamUrl.hostname;
        const connectionOptions = {
          host: networkHostname,
          port,
          lookup: createGuardedLookup(allowPrivateNetwork)
        };
        const upstreamSocket = isHttps
          ? tls.connect({
            ...connectionOptions,
            servername: net.isIP(networkHostname) ? undefined : networkHostname
          })
          : net.createConnection(connectionOptions);

        let headerBuffer = Buffer.alloc(0);
        let headersSent = false;

        const closeUpstream = () => {
          upstreamSocket.destroy();
        };

        const sendUpstreamRequest = () => {
          upstreamSocket.write(
            `GET ${requestPath} HTTP/1.1\r\n` +
            `Host: ${hostHeader}\r\n` +
            `User-Agent: VLC/3.0.18 LibVLC/3.0.18\r\n` +
            `Connection: close\r\n\r\n`
          );
        };

        clientRes.once('close', closeUpstream);
        upstreamSocket.once(isHttps ? 'secureConnect' : 'connect', sendUpstreamRequest);

        upstreamSocket.on('data', (chunk) => {
          proxyBytesDownloaded += chunk.length;
          if (headersSent) {
            if (!clientRes.write(chunk)) {
              upstreamSocket.pause();
              clientRes.once('drain', () => upstreamSocket.resume());
            }
            return;
          }

          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          const headerEnd = headerBuffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) {
            if (headerBuffer.length > 64 * 1024) {
              upstreamSocket.destroy(new Error('Upstream response headers are too large.'));
            }
            return;
          }

          const headerText = headerBuffer.subarray(0, headerEnd).toString('latin1');
          const responseMeta = parseRawHttpHeaders(headerText);
          const location = firstHeaderValue(responseMeta.headers, 'location');
          if (responseMeta.statusCode >= 300 && responseMeta.statusCode < 400 && location) {
            if (redirectCount >= MAX_REDIRECTS) {
              clientRes.writeHead(502);
              clientRes.end('Too many upstream redirects');
              return;
            }

            clientRes.removeListener('close', closeUpstream);
            upstreamSocket.destroy();
            pipeUrl(new URL(location, upstreamUrl).toString(), redirectCount + 1);
            return;
          }

          headersSent = true;
          clientRes.writeHead(responseMeta.statusCode >= 200 && responseMeta.statusCode < 400 ? 200 : responseMeta.statusCode, {
            'Content-Type': 'video/MP2T'
          });

          const body = headerBuffer.subarray(headerEnd + 4);
          if (body.length > 0) {
            if (!clientRes.write(body)) {
              upstreamSocket.pause();
              clientRes.once('drain', () => upstreamSocket.resume());
            }
          }
        });

        upstreamSocket.on('error', (err) => {
          console.error('Upstream relay failed:', err.message || err);
          clientRes.removeListener('close', closeUpstream);
          if (!clientRes.headersSent) {
            clientRes.writeHead(502);
          }
          clientRes.end();
        });

        upstreamSocket.on('end', () => {
          clientRes.removeListener('close', closeUpstream);
          clientRes.end();
        });
      };

      pipeUrl(sourceUrl);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        server.close();
        reject(new Error('Could not start upstream stream relay.'));
        return;
      }

      upstreamRelayServer = server;
      const relayUrl = `http://127.0.0.1:${address.port}/source`;
      server.freakyIptvTrustedUrl = relayUrl;
      registerTrustedLocalMediaUrl(relayUrl);
      resolve(relayUrl);
    });
  });
}

function writeCorsHeaders(response, extraHeaders = {}) {
  response.writeHead(extraHeaders.statusCode || 200, {
    ...extraHeaders.headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*'
  });
}

function startVlcOutputRelay(vlcOutputUrl) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((clientReq, clientRes) => {
      if (clientReq.method === 'OPTIONS') {
        writeCorsHeaders(clientRes, { statusCode: 204 });
        clientRes.end();
        return;
      }

      if (clientReq.method !== 'GET') {
        writeCorsHeaders(clientRes, { statusCode: 405 });
        clientRes.end('Method not allowed');
        return;
      }

      const upstreamReq = http.get(vlcOutputUrl, {
        headers: {
          'User-Agent': 'FreakyIPTV/1.0'
        }
      }, (upstreamRes) => {
        writeCorsHeaders(clientRes, {
          statusCode: upstreamRes.statusCode || 200,
          headers: {
            'Content-Type': upstreamRes.headers['content-type'] || 'video/MP2T',
            'Cache-Control': 'no-cache'
          }
        });

        upstreamRes.pipe(clientRes);
      });

      upstreamReq.on('error', (err) => {
        console.error('VLC output relay failed:', err.message || err);
        if (!clientRes.headersSent) {
          writeCorsHeaders(clientRes, { statusCode: 502 });
        }
        clientRes.end();
      });

      clientRes.on('close', () => {
        upstreamReq.destroy();
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || !address) {
        server.close();
        reject(new Error('Could not start VLC output relay.'));
        return;
      }

      vlcOutputRelayServer = server;
      const relayUrl = `http://127.0.0.1:${address.port}/stream`;
      server.freakyIptvTrustedUrl = relayUrl;
      registerTrustedLocalMediaUrl(relayUrl);
      resolve(relayUrl);
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error('Could not allocate a local proxy port.'));
        }
      });
    });
  });
}

function waitForTcpPort(port, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (!vlcProxyProcess || vlcProxyProcess.exitCode !== null) {
        reject(new Error('VLC proxy exited before opening its HTTP endpoint.'));
        return;
      }

      const socket = new net.Socket();
      let settled = false;

      const retry = () => {
        if (settled) return;
        settled = true;
        socket.destroy();

        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for VLC proxy on port ${port}.`));
          return;
        }

        setTimeout(tryConnect, 250);
      };

      socket.setTimeout(500);
      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve();
      });
      socket.once('timeout', retry);
      socket.once('error', retry);
      socket.connect(port, '127.0.0.1');
    };

    tryConnect();
  });
}

registerTrustedHandle('start-playback-relay', async (event, url) => {
  try {
    assertBoundedString(url, 'Stream URL', MAX_URL_LENGTH);
    assertHttpUrlText(url, 'Stream URL');
    const parsed = new URL(url);
    assertAllowedNetworkTarget(parsed.hostname, false);
    const relay = await startPlaybackRelayServer(url);
    relay.playbackReleased = false;
    return { ok: true, relayId: relay.id, url: relay.url };
  } catch (e) {
    console.error('Failed to start playback relay:', e);
    return {
      ok: false,
      errorCode: 'network',
      error: 'The live stream relay could not start.'
    };
  }
});

registerTrustedHandle('stop-playback-relay', (event, id) => {
  assertBoundedString(id, 'Playback relay id', 64, true);
  if (!id) return true;
  return stopPlaybackRelay(id);
});

registerTrustedHandle('get-playback-relay-traffic', (event, id) => {
  assertBoundedString(id, 'Playback relay id', 64, true);
  if (!id) return 0;
  return playbackRelays.get(id)?.bytesDownloaded || 0;
});

registerTrustedHandle('start-vlc-proxy', async (event, url, options = {}) => {
  stopVlcProxyProcess();
  
  try {
    assertBoundedString(url, 'Stream URL', MAX_URL_LENGTH);
    assertPlainObject(options, 'Proxy options');
    if (options.mode !== undefined && options.mode !== 'copy' && options.mode !== 'hardware') {
      throw new TypeError('Proxy mode must be copy or hardware.');
    }
    if (options.relayId !== undefined) assertBoundedString(options.relayId, 'Playback relay id', 64, true);
    const sharedRelay = options.relayId ? playbackRelays.get(options.relayId) : null;
    if (options.relayId && !sharedRelay) {
      throw new Error('The requested playback relay is no longer active.');
    }
    // Use the same decoded HTTP relay even when the renderer did not already
    // create one (for example, a native-player fallback). This prevents the
    // compatibility engine from ever receiving raw chunked HTTP framing.
    const relay = sharedRelay || await startPlaybackRelayServer(url);
    if (!sharedRelay) relay.playbackReleased = true;
    const relayUrl = relay.url;
    const { spawn } = require('child_process');
    const requestedMode = options && options.mode === 'hardware'
      ? (process.platform === 'darwin' ? 'hardware-videotoolbox' : 'hardware-d3d11')
      : 'copy';
    const audioEncoder = getPreferredAacEncoder();

    vlcOutputRelayServer = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        writeCorsHeaders(res, { statusCode: 204 });
        res.end();
        return;
      }

      console.log(`[FFmpeg proxy] Starting low CPU relay for ${redactUrlForLogs(url)}`);

      let responseSent = false;
      let activeProcess = null;
      let bytesSent = 0;
      let nextProgressLogBytes = 25 * 1024 * 1024;

      const runFfmpeg = (mode) => {
        if (req.socket.destroyed) {
          console.log('[FFmpeg proxy] Request socket already destroyed, aborting spawn');
          return;
        }

        const modes = getFfmpegProxyModes(process.platform, audioEncoder);
        const selectedMode = modes[mode] || modes.copy;
        const probeArgs = getFfmpegProbeArgs(process.platform, mode);

        console.log(`[FFmpeg proxy] Spawning FFmpeg mode: ${selectedMode.label}`);

        const proc = spawn(resolveFfmpegPath(), [
          '-hide_banner',
          '-loglevel', 'warning',
          // +genpts: regenerate PTS for better sync; discardcorrupt removed to
          // avoid dropping valid frames from live IPTV streams with minor TS issues
          '-fflags', '+genpts',
          ...probeArgs,
          '-user_agent', 'VLC/3.0.18 LibVLC/3.0.18',
          '-reconnect', '1',
          '-reconnect_at_eof', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '4',
          '-rw_timeout', '10000000',
          ...(selectedMode.inputArgs || []),
          '-i', relayUrl,
          ...selectedMode.args,
          '-sn',
          '-dn',
          '-f', 'mpegts',
          '-mpegts_flags', '+resend_headers',
          '-flush_packets', '1',
          'pipe:1'
        ], { windowsHide: true });

        activeProcess = proc;
        vlcProxyProcess = proc;

        proc.stdout.on('data', (chunk) => {
          if (!responseSent) {
            writeCorsHeaders(res, {
              statusCode: 200,
              headers: {
                'Content-Type': 'video/MP2T',
                'Cache-Control': 'no-cache'
              }
            });
            responseSent = true;
          }
          if (!res.write(chunk)) {
            proc.stdout.pause();
            res.once('drain', () => proc.stdout.resume());
          }
          bytesSent += chunk.length;
          if (bytesSent >= nextProgressLogBytes) {
            console.log(`[FFmpeg proxy] Sent ${bytesSent} bytes to client`);
            nextProgressLogBytes += 25 * 1024 * 1024;
          }
        });

        proc.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.log(`[FFmpeg] ${msg}`);
        });

        proc.on('exit', (code) => {
          console.log(`[FFmpeg proxy] Process (${selectedMode.label}) exited with code ${code}`);
          if (!responseSent && code !== 0 && code !== null && !req.socket.destroyed) {
            const nextMode = getNextFfmpegProxyMode(process.platform, mode);
            if (nextMode) {
              console.warn(`[FFmpeg proxy] ${selectedMode.label} failed before output, retrying ${nextMode}.`);
              runFfmpeg(nextMode);
              return;
            }
          }

          if (!res.writableEnded) {
            res.end();
          }
        });

        proc.on('error', (err) => {
          console.error(`[FFmpeg proxy] Process (${selectedMode.label}) error:`, err);
          if (!responseSent && !req.socket.destroyed) {
            const nextMode = getNextFfmpegProxyMode(process.platform, mode);
            if (nextMode) {
              console.warn(`[FFmpeg proxy] ${selectedMode.label} errored, retrying ${nextMode}.`);
              runFfmpeg(nextMode);
              return;
            }
          }

          if (!res.writableEnded) {
            res.end();
          }
        });
      };

      req.on('close', () => {
        console.log(`[FFmpeg proxy] Client closed connection, killing active ffmpeg process`);
        if (activeProcess) {
          activeProcess.kill();
        }
      });

      runFfmpeg(requestedMode);
    });

    return new Promise((resolve, reject) => {
      vlcOutputRelayServer.on('error', reject);
      vlcOutputRelayServer.listen(0, '127.0.0.1', () => {
        const address = vlcOutputRelayServer.address();
        const trustedUrl = `http://127.0.0.1:${address.port}/stream`;
        vlcOutputRelayServer.freakyIptvTrustedUrl = trustedUrl;
        registerTrustedLocalMediaUrl(trustedUrl);
        console.log(`[FFmpeg proxy] Relay server listening on local port: ${address.port}`);
        resolve({ ok: true, url: trustedUrl });
      });
    });
  } catch (e) {
    console.error('Failed to start FFmpeg proxy:', e);
    stopVlcProxyProcess();
    return {
      ok: false,
      errorCode: /ffmpeg/i.test(String(e?.message || e)) ? 'proxy' : 'network',
      error: 'The compatibility video engine could not start.'
    };
  }
});

registerTrustedHandle('stop-vlc-proxy', () => {
  stopVlcProxyProcess();
  return true;
});

registerTrustedHandle('get-proxy-traffic', () => {
  return proxyBytesDownloaded;
});

let mainWindow = null;
let keepPlaybackAwakeBlockerId = null;
let mainWindowCloseConfirmed = false;
let mainWindowCloseTimer = null;

registerTrustedOn('app-close-ready', () => {
  mainWindowCloseConfirmed = true;
  if (mainWindowCloseTimer !== null) {
    clearTimeout(mainWindowCloseTimer);
    mainWindowCloseTimer = null;
  }
  mainWindow.close();
});

function setPlaybackAwake(active) {
  if (active) {
    if (keepPlaybackAwakeBlockerId === null || !powerSaveBlocker.isStarted(keepPlaybackAwakeBlockerId)) {
      keepPlaybackAwakeBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    return true;
  }

  if (keepPlaybackAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepPlaybackAwakeBlockerId)) {
    powerSaveBlocker.stop(keepPlaybackAwakeBlockerId);
  }
  keepPlaybackAwakeBlockerId = null;
  return true;
}

registerTrustedHandle('set-playback-active', (event, active) => {
  if (typeof active !== 'boolean') throw new TypeError('Playback state must be a boolean.');
  return setPlaybackAwake(active);
});

registerTrustedHandle('set-window-fullscreen', (event, active) => {
  if (typeof active !== 'boolean') throw new TypeError('Fullscreen state must be a boolean.');
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.setFullScreen(active);
  return active;
});

registerTrustedHandle('focus-app-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  return true;
});

function createWindow() {
  Menu.setApplicationMenu(null);

  const iconPath = app.isPackaged
    ? path.join(__dirname, 'dist', 'cat_icon.png')
    : path.join(__dirname, 'public', 'cat_icon.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 600,
    title: 'Freaky IPTV',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      autoplayPolicy: 'no-user-gesture-required',
      // A macOS window can be temporarily treated as background while its
      // surface moves to an HDMI display or a Space changes. Keeping the
      // renderer live prevents timer/video frame throttling during that
      // transition. Windows retains the previous behaviour.
      backgroundThrottling: process.platform !== 'darwin'
    }
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setBackgroundColor('#101721');

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen-changed', false);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[Renderer] [${details.level}] ${details.message}`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  for (const navigationEvent of ['will-navigate', 'will-redirect']) {
    mainWindow.webContents.on(navigationEvent, (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
  }

  if (!app.isPackaged && process.env.FREAKYIPTV_E2E !== '1') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (mainWindowCloseConfirmed || !mainWindow || mainWindow.isDestroyed()) return;

    event.preventDefault();
    mainWindow.webContents.send('app-before-close');

    if (mainWindowCloseTimer === null) {
      mainWindowCloseTimer = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindowCloseConfirmed = true;
        mainWindow.close();
      }, 3000);
    }
  });

  mainWindow.on('closed', () => {
    setPlaybackAwake(false);
    if (mainWindowCloseTimer !== null) {
      clearTimeout(mainWindowCloseTimer);
      mainWindowCloseTimer = null;
    }
    mainWindowCloseConfirmed = false;
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    const initResult = await dataStore.init();
    dataRecoveryNotice = initResult?.recoveryNotice || null;
    scheduleReminders(await dataStore.loadReminders());
    await pruneSafetySnapshots();
  } catch (error) {
    console.error('Failed to initialize the local data store:', error);
  }
  const { session } = require('electron');
  protocol.handle('freaky-recording', request => {
    try {
      const id = decodeURIComponent(new URL(request.url).hostname);
      const entry = resolveRecordingId(id);
      return electronNet.fetch(pathToFileURL(entry.absolutePath).toString());
    } catch {
      return new Response('Recording not found.', { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    shouldBlockRendererNetworkRequest(details)
      .then(cancel => callback({ cancel }))
      .catch((error) => {
        console.warn('Failed to evaluate renderer network request:', error.message || error);
        callback({ cancel: true });
      });
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url.toLowerCase();
    const isControlledPlaybackRequest =
      mainWindow &&
      !mainWindow.isDestroyed() &&
      details.webContentsId === mainWindow.webContents.id &&
      (details.resourceType === 'media' || details.resourceType === 'xhr') &&
      (url.startsWith('http://') || url.startsWith('https://'));
    if (isControlledPlaybackRequest) {
      details.requestHeaders['User-Agent'] = 'VLC/3.0.18 LibVLC/3.0.18';
      delete details.requestHeaders['Origin'];
      delete details.requestHeaders['Referer'];
      
      // Delete browser-specific headers to match native VLC player exactly
      delete details.requestHeaders['sec-ch-ua'];
      delete details.requestHeaders['sec-ch-ua-mobile'];
      delete details.requestHeaders['sec-ch-ua-platform'];
      delete details.requestHeaders['sec-fetch-dest'];
      delete details.requestHeaders['sec-fetch-mode'];
      delete details.requestHeaders['sec-fetch-site'];
      delete details.requestHeaders['sec-fetch-user'];
      delete details.requestHeaders['upgrade-insecure-requests'];
      delete details.requestHeaders['accept-language'];
    }
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let responseHeaders = details.responseHeaders;

    try {
      const url = new URL(details.url);
      const isLocalHttpProxy =
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1');

      const isTrustedMediaResponse =
        mainWindow &&
        !mainWindow.isDestroyed() &&
        details.webContentsId === mainWindow.webContents.id &&
        (details.resourceType === 'xhr' || details.resourceType === 'media');

      const isTrustedRendererDocument =
        mainWindow &&
        !mainWindow.isDestroyed() &&
        details.webContentsId === mainWindow.webContents.id &&
        details.resourceType === 'mainFrame' &&
        isTrustedRendererUrl(details.url);

      if (isLocalHttpProxy || isTrustedMediaResponse) {
        responseHeaders = {
          ...responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Methods': ['GET, OPTIONS'],
          'Access-Control-Allow-Headers': ['*']
        };
      }
      if (isTrustedRendererDocument) {
        responseHeaders = {
          ...responseHeaders,
          'Content-Security-Policy': ["frame-ancestors 'none'"]
        };
      }
    } catch {
      // Ignore URLs Electron cannot parse and leave their headers unchanged.
    }

    callback({ responseHeaders });
  });

  createWindow();

  // Initialize Discord RPC settings
  const settings = loadSettingsFromFile();
  applyDiscordSettings(
    settings.discordRpcEnabled,
    settings.discordShowChannel,
    settings.discordShowProgram,
    settings.discordShowArtwork,
    settings.discordClientId
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopVlcProxyProcess();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cleanupDiscordSocket();
  setPlaybackAwake(false);
  stopVlcProxyProcess();
  stopRecordingPlaybackProxy();
  void dataStore.close();
});

// --- Discord Rich Presence Integration ---

let discordAppIconUrl = 'https://cdn.discordapp.com/app-icons/1514411481259577364/a9d1b783394865061c51ccf5b9e56338.png';

function fetchDiscordAppIcon(clientId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    };
    const request = https.get(`https://discord.com/api/v9/oauth2/applications/${clientId}/rpc`, options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        finish(null);
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 64 * 1024) {
          request.destroy(new Error('Discord application response is too large.'));
        }
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          finish(parsed && parsed.icon ? parsed.icon : null);
        } catch {
          finish(null);
        }
      });
    });
    request.setTimeout(5000, () => {
      request.destroy(new Error('Discord application request timed out.'));
    });
    request.on('error', (err) => {
      console.error('[Discord RPC] HTTP Error fetching application details:', err.message);
      finish(null);
    });
  });
}

async function updateDiscordAppIconUrl(clientId) {
  if (!clientId) {
    discordAppIconUrl = 'https://cdn.discordapp.com/app-icons/1514411481259577364/a9d1b783394865061c51ccf5b9e56338.png';
    return;
  }
  if (clientId === '1514411481259577364') {
    discordAppIconUrl = 'https://cdn.discordapp.com/app-icons/1514411481259577364/a9d1b783394865061c51ccf5b9e56338.png';
    return;
  }
  const iconHash = await fetchDiscordAppIcon(clientId);
  if (iconHash) {
    discordAppIconUrl = `https://cdn.discordapp.com/app-icons/${clientId}/${iconHash}.png`;
    console.log('[Discord RPC] App Icon URL updated to:', discordAppIconUrl);
  } else {
    discordAppIconUrl = 'https://cdn.discordapp.com/app-icons/1514411481259577364/a9d1b783394865061c51ccf5b9e56338.png';
  }
}

function connectDiscordRpc() {
  if (discordRpcSocket || isDiscordConnected || isConnecting || !currentDiscordSettings.enabled) return;

  isConnecting = true;
  const ipcPaths = getDiscordIpcPaths({ platform: process.platform, env: process.env });
  let candidateIndex = 0;

  function tryNextPipe() {
    if (!currentDiscordSettings.enabled) { isConnecting = false; return; }
    if (candidateIndex >= ipcPaths.length) {
      isConnecting = false;
      scheduleDiscordReconnect();
      return;
    }

    const socket = net.createConnection(ipcPaths[candidateIndex]);

    const handleConnectionError = () => {
      socket.destroy();
      candidateIndex++;
      tryNextPipe();
    };

    socket.once('error', handleConnectionError);
    socket.once('connect', () => {
      socket.removeListener('error', handleConnectionError);
      discordRpcSocket = socket;
      isConnecting = false;
      discordReadBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        discordReadBuffer = Buffer.concat([discordReadBuffer, chunk]);
        processDiscordBuffer();
      });

      socket.once('close', () => {
        if (discordRpcSocket !== socket) return;
        cleanupDiscordSocket();
        scheduleDiscordReconnect();
      });

      socket.once('error', (err) => {
        console.error('[Discord RPC] Socket error:', err.message);
      });

      // Send handshake (opcode 0) immediately after connection
      const handshake = { v: 1, client_id: discordClientId };
      sendDiscordPacket(0, handshake);
    });
  }

  tryNextPipe();
}

// Process all complete packets sitting in discordReadBuffer
function processDiscordBuffer() {
  while (discordReadBuffer.length >= 8) {
    const len = discordReadBuffer.readUInt32LE(4);
    if (len > MAX_DISCORD_PACKET_BYTES) {
      console.error('[Discord RPC] Rejected oversized IPC packet:', len);
      cleanupDiscordSocket();
      scheduleDiscordReconnect();
      return;
    }
    if (discordReadBuffer.length < 8 + len) break; // wait for more data

    const op = discordReadBuffer.readUInt32LE(0);
    const body = discordReadBuffer.slice(8, 8 + len).toString('utf8');
    discordReadBuffer = discordReadBuffer.slice(8 + len);

    try {
      const msg = JSON.parse(body);
      if (op === 1 && msg.evt === 'READY') {
        isDiscordConnected = true;
        console.log('[Discord RPC] READY - connection confirmed');
        // Send queued presence now that we are confirmed connected
        if (lastActiveChannelName) {
          updateDiscordPresenceForActiveChannel(lastActiveChannelName, lastActiveChannelStartTime, lastActiveChannelLogoUrl, lastActiveChannelProgramTitle);
        } else {
          updateDiscordPresenceIdle();
        }
      } else if (op === 1 && msg.evt === 'ERROR') {
        const code = msg.data?.code ?? 'unknown';
        const message = msg.data?.message || 'Discord rejected the RPC command.';
        console.error(`[Discord RPC] Command failed (${code}): ${message}`);
      } else if (op === 2) {
        console.error('[Discord RPC] Discord closed the IPC connection:', msg.message || body);
        cleanupDiscordSocket();
        scheduleDiscordReconnect();
        return;
      }
    } catch (e) {
      console.error('[Discord RPC] Failed to parse packet:', e.message);
    }
  }
}

function sendDiscordPacket(op, payload, onFlushed) {
  if (!discordRpcSocket || discordRpcSocket.destroyed) return false;

  const jsonStr = JSON.stringify(payload);
  const jsonLen = Buffer.byteLength(jsonStr);
  const packet = Buffer.alloc(8 + jsonLen);

  packet.writeUInt32LE(op, 0);
  packet.writeUInt32LE(jsonLen, 4);
  packet.write(jsonStr, 8);

  discordRpcSocket.write(packet, (err) => {
    if (err) {
      console.error('[Discord RPC] Failed to write IPC packet:', err.message);
      return;
    }
    onFlushed?.();
  });
  return true;
}

function scheduleDiscordReconnect(delayMs = 15000) {
  if (!currentDiscordSettings.enabled || discordConnectTimeout) return;

  discordConnectTimeout = setTimeout(() => {
    discordConnectTimeout = null;
    connectDiscordRpc();
  }, delayMs);
}

function cleanupDiscordSocket() {
  isDiscordConnected = false;
  isConnecting = false;
  discordReadBuffer = Buffer.alloc(0);
  if (discordConnectTimeout) {
    clearTimeout(discordConnectTimeout);
    discordConnectTimeout = null;
  }
  if (discordRpcSocket) {
    try { discordRpcSocket.destroy(); } catch {}
    discordRpcSocket = null;
  }
}

async function applyDiscordSettings(enabled, showChannel, showProgram, showArtwork, clientId) {
  const oldClientId = currentDiscordSettings.clientId;
  const oldEnabled = currentDiscordSettings.enabled;

  currentDiscordSettings.enabled = enabled !== undefined ? enabled : true;
  currentDiscordSettings.showChannel = showChannel !== undefined ? showChannel : true;
  currentDiscordSettings.showProgram = showProgram !== undefined ? showProgram : true;
  currentDiscordSettings.showArtwork = showArtwork !== undefined ? showArtwork : true;
  currentDiscordSettings.clientId = clientId || '1514411481259577364';

  if (!currentDiscordSettings.enabled) {
    if (oldEnabled && isDiscordConnected) {
      const clearSent = clearDiscordPresence(() => cleanupDiscordSocket());
      if (!clearSent) cleanupDiscordSocket();
    } else {
      cleanupDiscordSocket();
    }
    return;
  }

  if (currentDiscordSettings.clientId !== oldClientId) {
    cleanupDiscordSocket();
  }

  discordClientId = currentDiscordSettings.clientId;

  await updateDiscordAppIconUrl(currentDiscordSettings.clientId);

  if (lastActiveChannelName) {
    updateDiscordPresenceForActiveChannel(lastActiveChannelName, lastActiveChannelStartTime, lastActiveChannelLogoUrl, lastActiveChannelProgramTitle);
  } else {
    updateDiscordPresenceIdle();
  }
}

function normalizeDiscordText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  const usable = text.length >= 2 ? text : fallback;
  return Array.from(usable).slice(0, 128).join('');
}

function updateDiscordPresence(details, state, startTime, logoUrl) {
  if (!app.isPackaged) console.log('[Discord RPC Main] Updating activity');
  if (!isDiscordConnected) {
    console.log('[Discord RPC Main] Socket not connected, connecting...');
    connectDiscordRpc();
    return;
  }

  const validStartTime = startTime instanceof Date && Number.isFinite(startTime.getTime())
    ? startTime
    : null;
  const validLogoUrl = typeof logoUrl === 'string' && logoUrl.length <= MAX_DISCORD_ASSET_LENGTH
    ? logoUrl
    : null;
  const payload = {
    cmd: 'SET_ACTIVITY',
    args: {
      pid: process.pid,
      activity: {
        details: normalizeDiscordText(details, 'Watching Live TV'),
        state: normalizeDiscordText(state, 'Watching Freaky IPTV'),
        assets: {
          large_image: validLogoUrl || discordAppIconUrl || 'freaky_logo',
          large_text: 'Freaky IPTV',
          small_image: validLogoUrl && discordAppIconUrl ? discordAppIconUrl : undefined,
          small_text: validLogoUrl && discordAppIconUrl ? 'Freaky IPTV' : undefined
        },
        timestamps: validStartTime ? { start: Math.round(validStartTime.getTime()) } : undefined
      }
    },
    nonce: crypto.randomUUID()
  };

  sendDiscordPacket(1, payload);
}

function clearDiscordPresence(onFlushed) {
  if (!isDiscordConnected) return false;

  const payload = {
    cmd: 'SET_ACTIVITY',
    args: {
      pid: process.pid,
      activity: null
    },
    nonce: crypto.randomUUID()
  };

  return sendDiscordPacket(1, payload, onFlushed);
}

function updateDiscordPresenceForActiveChannel(channelName, startTimeIso, logoUrl, programTitle) {
  if (!app.isPackaged) console.log('[Discord RPC Main] Updating active channel activity');
  lastActiveChannelName = channelName;
  lastActiveChannelStartTime = startTimeIso;
  lastActiveChannelLogoUrl = logoUrl;
  lastActiveChannelProgramTitle = programTitle;

  if (!currentDiscordSettings.enabled) return;

  const startTime = startTimeIso ? new Date(startTimeIso) : null;
  const displayState = currentDiscordSettings.showProgram && programTitle
    ? programTitle
    : 'Watching Freaky IPTV';
  const displayDetails = currentDiscordSettings.showChannel ? channelName : 'Watching Live TV';

  let proxiedLogoUrl = null;
  if (currentDiscordSettings.showArtwork && logoUrl && logoUrl.startsWith('http')) {
    proxiedLogoUrl = `https://images.weserv.nl/?url=${encodeURIComponent(logoUrl)}&w=512&h=512&fit=contain&output=png`;
  }

  updateDiscordPresence(displayDetails, displayState, startTime, proxiedLogoUrl);
}

function updateDiscordPresenceIdle() {
  if (!currentDiscordSettings.enabled) return;
  updateDiscordPresence('Browsing Channels', 'Idle', null, null);
}

// IPC Handlers for Discord Presence
registerTrustedHandle('set-discord-activity', (event, channelName, startTimeIso, logoUrl, programTitle) => {
  assertBoundedString(channelName, 'Channel name', 256);
  assertBoundedString(startTimeIso, 'Playback start time', 64, true);
  assertBoundedString(logoUrl, 'Channel logo URL', MAX_DISCORD_ASSET_LENGTH, true);
  assertBoundedString(programTitle, 'Programme title', 256, true);
  if (!app.isPackaged) console.log('[Discord RPC IPC] Activity update received');
  updateDiscordPresenceForActiveChannel(channelName, startTimeIso, logoUrl, programTitle);
  return true;
});

registerTrustedHandle('clear-discord-activity', () => {
  if (!app.isPackaged) console.log('[Discord RPC IPC] Activity clear received');
  lastActiveChannelName = null;
  lastActiveChannelStartTime = null;
  lastActiveChannelLogoUrl = null;
  lastActiveChannelProgramTitle = null;
  if (currentDiscordSettings.enabled) {
    updateDiscordPresenceIdle();
  }
  return true;
});
