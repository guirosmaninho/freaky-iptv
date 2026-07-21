import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEPG, parseXmlTvDate } from '../src/services/epgParser';

describe('XMLTV parsing', () => {
  it('rejects impossible dates, offsets outside fourteen hours, and trailing content', () => {
    assert.equal(parseXmlTvDate('20260230090000 +0000'), null);
    assert.equal(parseXmlTvDate('20260101120000 +1460'), null);
    assert.equal(parseXmlTvDate('20260101120000 +1401'), null);
    assert.equal(parseXmlTvDate('20260101120000Z trailing'), null);
    assert.equal(parseXmlTvDate('20260101120000 +0000'), '2026-01-01T12:00:00.000Z');
  });

  it('fails an invalid XML document instead of replacing a valid guide with an empty one', () => {
    assert.throws(() => parseEPG('<tv><programme>'), /XML parsing error/i);
  });
});
