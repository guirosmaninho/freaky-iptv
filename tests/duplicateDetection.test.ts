import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collapseExactUrlDuplicates, findDuplicateCandidates } from '../src/services/duplicateDetection';
import type { Channel } from '../src/types';

const channel = (id: string, streamUrl: string, name = 'News HD', tvgId = ''): Channel => ({ id, streamUrl, name, tvgId, logoUrl: '', groupTitle: 'News', duration: -1, attributes: {} });

describe('duplicate detection', () => {
  it('collapses only identical stream URLs and keeps quality variants', () => {
    const result = collapseExactUrlDuplicates([channel('one', 'https://example.test/live'), channel('two', 'https://example.test/live'), channel('three', 'https://example.test/other', 'News 4K')]);
    assert.deepEqual(result.map(item => item.id), ['one', 'three']);
  });

  it('creates non-destructive review candidates by tvg id or base name and group', () => {
    const candidates = findDuplicateCandidates([channel('one', 'https://one', 'News HD', 'news'), channel('two', 'https://two', 'Other', 'news'), channel('three', 'https://three', 'Cinema FHD'), channel('four', 'https://four', 'Cinema SD')]);
    assert.equal(candidates.length, 2);
  });
});
