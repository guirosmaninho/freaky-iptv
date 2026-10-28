import assert from 'node:assert/strict';
import { it } from 'node:test';
import { getChannelBaseName, getChannelBaseNamePreserveCase, getChannelQualityLabel } from '../src/services/utils';
import { normalizeQualityMappings } from '../src/services/settingsValidation';

it('recognizes Full HD in existing default settings and groups it with HD', () => {
  const mappings = normalizeQualityMappings({ FHD: 'fhd, 1080p, 1080' });
  assert.equal(getChannelQualityLabel('PT: RTP 1 Full HD', mappings), 'FHD');
  assert.equal(getChannelBaseName('PT: RTP 1 Full HD', mappings), getChannelBaseName('PT: RTP 1 HD', mappings));
  assert.equal(getChannelBaseNamePreserveCase('PT: RTP 1 Full HD', mappings), 'RTP 1');
});

it('preserves custom mappings and separates different channel names', () => {
  const mappings = normalizeQualityMappings({ FHD: 'full hd, custom1080', HD: 'hd' });
  assert.equal(getChannelQualityLabel('PT: RTP 1 custom1080', mappings), 'FHD');
  assert.notEqual(getChannelBaseName('PT: RTP 1 HD', mappings), getChannelBaseName('PT: RTP 2 HD', mappings));
  assert.equal(getChannelBaseNamePreserveCase('PT: SIC Notícias HD', mappings), 'SIC Notícias');
});

it('retains meaningful channel punctuation when removing quality labels', () => {
  const mappings = normalizeQualityMappings({});
  assert.equal(getChannelBaseNamePreserveCase('FR: Canal+ Full HD', mappings), 'Canal+');
  assert.equal(getChannelBaseNamePreserveCase('C++ HD', mappings), 'C++');
  assert.equal(getChannelBaseNamePreserveCase('PT: Porto-Sport HD', mappings), 'Porto-Sport');
  assert.equal(getChannelBaseNamePreserveCase('PT: SIC Notícias - HD', mappings), 'SIC Notícias');
  assert.equal(getChannelBaseNamePreserveCase('PT: RTP 1 (Full HD)', mappings), 'RTP 1');
  assert.notEqual(getChannelBaseName('FR: Canal+ HD', mappings), getChannelBaseName('FR: Canal HD', mappings));
  assert.equal(getChannelBaseName('PT: RTP 1 - Full HD', mappings), getChannelBaseName('PT: RTP 1 HD', mappings));
  assert.equal(getChannelBaseName('PT: RTP 1-HD', mappings), getChannelBaseName('PT: RTP 1 HD', mappings));
});
