const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sanitizeFilePart(value) {
  let sanitized = String(value || 'Channel')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  if (!sanitized) sanitized = 'Channel';
  if (WINDOWS_RESERVED_NAME.test(sanitized)) sanitized = `_${sanitized}`;
  return sanitized;
}

function timestampPart(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function createUniqueMediaPath(directory, channelName, extension, now = new Date()) {
  fs.mkdirSync(directory, { recursive: true });
  const base = `FreakyIPTV_${sanitizeFilePart(channelName)}_${timestampPart(now)}`;
  let candidate = path.join(directory, `${base}${extension}`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${base}_${suffix}${extension}`);
    suffix += 1;
  }
  return candidate;
}

function assertWritableDirectory(directory) {
  if (typeof directory !== 'string' || directory.length === 0 || directory.length > 4096 || !path.isAbsolute(directory)) {
    throw new TypeError('Recording directory must be an absolute path.');
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.W_OK);
  return directory;
}

function clampCaptureBounds(requested, content) {
  const x = Number(requested?.x);
  const y = Number(requested?.y);
  const width = Number(requested?.width);
  const height = Number(requested?.height);
  const contentWidth = Number(content?.width);
  const contentHeight = Number(content?.height);
  if (![x, y, width, height, contentWidth, contentHeight].every(Number.isFinite)) {
    throw new RangeError('Capture bounds must contain finite numbers.');
  }

  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(Math.floor(contentWidth), Math.ceil(x + width));
  const bottom = Math.min(Math.floor(contentHeight), Math.ceil(y + height));
  const result = { x: left, y: top, width: right - left, height: bottom - top };
  if (result.width < 2 || result.height < 2) {
    throw new RangeError('Capture bounds are outside the application window.');
  }
  return result;
}

function decodePngDataUrl(value, maxBytes = 16 * 1024 * 1024) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) {
    throw new TypeError('Image must be a base64 PNG data URL.');
  }
  const encoded = value.slice('data:image/png;base64,'.length);
  if (!encoded || encoded.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new RangeError('PNG payload has an invalid size or encoding.');
  }
  return validatePngBuffer(Buffer.from(encoded, 'base64'), maxBytes);
}

function validatePngBuffer(value, maxBytes = 16 * 1024 * 1024) {
  const png = Buffer.from(value || []);
  if (png.length === 0 || png.length > maxBytes || png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new RangeError('PNG payload is empty, too large, or has an invalid signature.');
  }
  return png;
}

module.exports = { assertWritableDirectory, clampCaptureBounds, createUniqueMediaPath, decodePngDataUrl, sanitizeFilePart, timestampPart, validatePngBuffer };
