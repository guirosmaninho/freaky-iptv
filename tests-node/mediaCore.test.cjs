const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');

const { clampCaptureBounds, createUniqueMediaPath, decodePngDataUrl, sanitizeFilePart, validatePngBuffer } = require('../electron/mediaCore.cjs');

describe('media filenames', () => {
  it('removes Windows reserved characters and device names', () => {
    assert.equal(sanitizeFilePart('Sport: TV / HD?'), 'Sport_ TV _ HD_');
    assert.equal(sanitizeFilePart('CON'), '_CON');
  });

  it('never overwrites an existing capture', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freaky-media-'));
    try {
      const now = new Date('2026-06-20T10:11:12Z');
      const first = createUniqueMediaPath(directory, 'Sport TV', '.png', now);
      fs.writeFileSync(first, 'existing');
      const second = createUniqueMediaPath(directory, 'Sport TV', '.png', now);
      assert.notEqual(second, first);
      assert.match(path.basename(second), /_2\.png$/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('capture bounds', () => {
  it('intersects a renderer rectangle with the native content area', () => {
    assert.deepEqual(
      clampCaptureBounds({ x: -0.4, y: 0, width: 1921.2, height: 1081 }, { width: 1920, height: 1080 }),
      { x: 0, y: 0, width: 1920, height: 1080 }
    );
  });

  it('rejects non-finite and empty capture rectangles', () => {
    assert.throws(() => clampCaptureBounds({ x: 0, y: 0, width: Number.NaN, height: 10 }, { width: 100, height: 100 }));
    assert.throws(() => clampCaptureBounds({ x: 150, y: 0, width: 10, height: 10 }, { width: 100, height: 100 }));
  });
});

describe('PNG payloads', () => {
  it('accepts a bounded PNG data URL and returns its bytes', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const result = decodePngDataUrl(`data:image/png;base64,${bytes.toString('base64')}`);
    assert.deepEqual(result, bytes);
  });

  it('rejects non-PNG and oversized payloads', () => {
    const text = Buffer.from('not a png').toString('base64');
    assert.throws(() => decodePngDataUrl(`data:image/png;base64,${text}`), /invalid signature/);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    assert.throws(() => decodePngDataUrl(`data:image/png;base64,${png.toString('base64')}`, 8), /too large/);
  });

  it('validates binary PNG payloads received through IPC', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4]);
    assert.deepEqual(validatePngBuffer(bytes), Buffer.from(bytes));
  });
});
