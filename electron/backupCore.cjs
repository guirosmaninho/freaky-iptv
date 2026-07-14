const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const BACKUP_VERSION = 2;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

function validateBackupPassword(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 1024;
}

async function encryptBackup(payload, password) {
  if (!validateBackupPassword(password)) throw new TypeError('Backup password must contain at least 10 characters.');
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plaintext.length > MAX_BACKUP_BYTES) throw new RangeError('Backup is too large.');

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    format: 'FreakyIPTVBackup',
    version: BACKUP_VERSION,
    kdf: { name: 'scrypt', N: 16384, r: 8, p: 1, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    ciphertext: ciphertext.toString('base64')
  };
}

function assertBackupEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Backup could not be opened.');
  if (envelope.format !== 'FreakyIPTVBackup' || ![1, BACKUP_VERSION].includes(envelope.version)) throw new Error('Backup could not be opened.');
  if (envelope.kdf?.name !== 'scrypt' || envelope.cipher?.name !== 'aes-256-gcm') throw new Error('Backup could not be opened.');
  if (envelope.kdf.N !== 16384 || envelope.kdf.r !== 8 || envelope.kdf.p !== 1) throw new Error('Backup could not be opened.');
  for (const value of [envelope.kdf.salt, envelope.cipher.iv, envelope.cipher.tag, envelope.ciphertext]) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BACKUP_BYTES * 2) throw new Error('Backup could not be opened.');
  }
}

function validateBackupPayload(payload) {
  try {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || ![1, 2].includes(payload.schemaVersion)) throw new Error();
    if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) throw new Error();
    if (!Array.isArray(payload.history) || payload.history.length > 100000) throw new Error();
    if (payload.history.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error();
    if (payload.schemaVersion === 2 && payload.reminders !== undefined && (!Array.isArray(payload.reminders) || payload.reminders.length > 10000)) throw new Error();
    for (const key of ['playlistUrl', 'epgUrl', 'recordingDirectory']) {
      const value = payload.settings[key];
      if (value !== undefined && (typeof value !== 'string' || value.length > 16384)) throw new Error();
    }
    for (const key of ['favoriteChannelIds', 'recentlyViewedChannelIds', 'openedReviewIds', 'dismissedReviewIds']) {
      const values = payload.settings[key];
      const isReviewIdList = key === 'openedReviewIds' || key === 'dismissedReviewIds';
      const limit = isReviewIdList ? 128 : 100000;
      const maxLength = isReviewIdList ? 64 : 1024;
      if (values !== undefined && (!Array.isArray(values) || values.length > limit || values.some(value => typeof value !== 'string' || value.length > maxLength))) throw new Error();
    }
    return payload;
  } catch {
    throw new Error('Backup could not be opened. Check the password and file.');
  }
}

async function decryptBackup(envelope, password) {
  try {
    if (!validateBackupPassword(password)) throw new Error('invalid password');
    assertBackupEnvelope(envelope);
    const salt = Buffer.from(envelope.kdf.salt, 'base64');
    const iv = Buffer.from(envelope.cipher.iv, 'base64');
    const tag = Buffer.from(envelope.cipher.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_BACKUP_BYTES) throw new Error('invalid envelope');
    const key = await scrypt(password, salt, 32, {
      N: envelope.kdf.N,
      r: envelope.kdf.r,
      p: envelope.kdf.p,
      maxmem: 64 * 1024 * 1024
    });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plaintext.toString('utf8'));
    return validateBackupPayload(payload);
  } catch {
    throw new Error('Backup could not be opened. Check the password and file.');
  }
}

function dedupeStrings(primary = [], secondary = [], limit = 100000) {
  const result = [];
  const seen = new Set();
  for (const value of [...primary, ...secondary]) {
    if (typeof value !== 'string' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function historyKey(item) {
  if (item && typeof item.sessionId === 'string' && item.sessionId) return `id:${item.sessionId}`;
  return `fallback:${item?.channelId || ''}|${item?.startTimeUtc || ''}|${item?.endTimeUtc || ''}`;
}

function mergeImportedData(current, imported) {
  const importedSettings = imported?.settings || {};
  const currentSettings = current?.settings || {};
  const settings = {
    ...importedSettings,
    favoriteChannelIds: dedupeStrings(importedSettings.favoriteChannelIds, currentSettings.favoriteChannelIds),
    recentlyViewedChannelIds: dedupeStrings(importedSettings.recentlyViewedChannelIds, currentSettings.recentlyViewedChannelIds, 24),
    openedReviewIds: dedupeStrings(importedSettings.openedReviewIds, currentSettings.openedReviewIds, 128),
    dismissedReviewIds: dedupeStrings(importedSettings.dismissedReviewIds, currentSettings.dismissedReviewIds, 128)
  };

  const history = [];
  const seenHistory = new Set();
  for (const item of [...(current?.history || []), ...(imported?.history || [])]) {
    const key = historyKey(item);
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    history.push(item);
  }
  const reminders = Array.isArray(imported?.reminders) ? imported.reminders : [];
  return { settings, history, reminders };
}

module.exports = {
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  decryptBackup,
  encryptBackup,
  mergeImportedData,
  validateBackupPayload,
  validateBackupPassword
};
