import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findDuplicateQualityKeywords,
  normalizeQualityMappings,
  redactSensitiveUrl,
  validateSourceUrl
} from '../src/services/settingsValidation';

describe('settings validation', () => {
  it('rejects unsupported source URL protocols', () => {
    assert.equal(validateSourceUrl('file:///C:/playlist.m3u', true), 'Only HTTP and HTTPS URLs are supported.');
  });

  it('accepts an empty optional EPG URL', () => {
    assert.equal(validateSourceUrl('', false), null);
  });

  it('redacts credentials and sensitive query values', () => {
    const redacted = redactSensitiveUrl('https://user:secret@example.com/get.php?username=demo&password=pass&type=m3u');

    assert.equal(redacted, 'https://***:***@example.com/get.php?username=***&password=***&type=m3u');
  });

  it('drops dangerous quality mapping keys and detects duplicate keywords', () => {
    const mappings = normalizeQualityMappings({
      FHD: 'fhd, 1080p',
      HD: 'hd, 1080p',
      __proto__: 'polluted'
    });

    assert.equal(Object.prototype.hasOwnProperty.call(mappings, '__proto__'), false);
    assert.deepEqual(findDuplicateQualityKeywords(mappings), ['1080p']);
  });
});
