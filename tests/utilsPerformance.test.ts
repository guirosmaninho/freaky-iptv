import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  getChannelBaseName,
  getChannelBaseNamePreserveCase,
  getChannelQualityLabel
} from '../src/services/utils';

it('reuses compiled quality matchers across channel lookups', () => {
  const originalRegExp = globalThis.RegExp;
  let constructedRegExps = 0;
  const CountingRegExp = function (pattern: string | RegExp, flags?: string) {
    constructedRegExps += 1;
    return new originalRegExp(pattern, flags);
  } as unknown as RegExpConstructor;
  Object.setPrototypeOf(CountingRegExp, originalRegExp);
  const globals = globalThis as unknown as { RegExp: RegExpConstructor };
  const mappings = {
    '4K': 'ultra-unique-2160',
    FHD: 'full-unique-1080',
    HEVC: 'codec-unique-hevc',
    HD: 'high-unique-720',
    SD: 'standard-unique-576',
    Low: 'mobile-unique-low',
    Backup: 'backup-unique-feed'
  };

  globals.RegExp = CountingRegExp;
  try {
    getChannelBaseName('PT: News full-unique-1080', mappings);
    getChannelBaseNamePreserveCase('PT: News full-unique-1080', mappings);
    getChannelQualityLabel('PT: News full-unique-1080', mappings);
    constructedRegExps = 0;

    for (let index = 0; index < 100; index += 1) {
      getChannelBaseName(`PT: News ${index} full-unique-1080`, mappings);
      getChannelBaseNamePreserveCase(`PT: News ${index} full-unique-1080`, mappings);
      getChannelQualityLabel(`PT: News ${index} full-unique-1080`, mappings);
    }
  } finally {
    globals.RegExp = originalRegExp;
  }

  assert.equal(constructedRegExps, 0);
});
