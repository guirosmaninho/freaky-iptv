import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEPG } from '../src/services/epgParser';

const programme = '<programme channel="news" start="20261022120000 +0200" stop="20261022130000 +0200"><title>Bulletin</title></programme>';

test('parses XMLTV metadata, entities, CDATA and nested text without a DOM', () => {
  const guide = parseEPG(`<?xml version="1.0"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv>
    <channel id="news"><display-name>News &amp; Sport</display-name></channel>
    <programme channel="news" start="20261022120000 +0200" stop="20261022130000 +0200">
      <title>News &amp; <b>Sport</b></title><title>Other language</title><sub-title>Live</sub-title>
      <desc><![CDATA[One < two]]></desc><category>News</category><icon src="javascript:alert(1)"/>
    </programme></tv>`);
  assert.equal(guide.displayNames.news, 'News & Sport');
  const item = guide.programsByChannel.news[0];
  assert.equal(item.title, 'News & Sport');
  assert.equal(item.subTitle, 'Live');
  assert.equal(item.description, 'One < two');
  assert.equal(item.startUtc, '2026-10-22T10:00:00.000Z');
  assert.equal(item.iconUrl, '');
  assert.equal(guide.issues.length, 0);
});

for (const [name, xml] of Object.entries({
  'mismatched tags': '<tv><programme></tv>',
  'bare ampersand': `<tv>${programme.replace('Bulletin', 'News & Sport')}</tv>`,
  'trailing garbage': `<tv>${programme}</tv>garbage`,
  'invalid XML characters': `<tv>${programme.replace('Bulletin', 'News\0')}</tv>`,
  'unresolved external entities': `<!DOCTYPE tv [<!ENTITY external SYSTEM "https://example.com/private">]><tv>${programme.replace('Bulletin', '&external;')}</tv>`
})) {
  test(`rejects ${name} even when the document contains a valid programme`, () => {
    assert.throws(() => parseEPG(xml), /XML parsing error/);
  });
}

test('handles source identifiers safely and keeps the first duplicate display name', () => {
  const guide = parseEPG(`<tv><channel id="__proto__"><display-name>Original</display-name></channel>
    <channel id="__proto__"><display-name>Duplicate</display-name></channel>
    ${programme.replace('channel="news"', 'channel="__proto__"')}</tv>`);
  assert.equal(guide.displayNames.__proto__, 'Original');
  assert.equal(guide.programsByChannel.__proto__[0].title, 'Bulletin');
  assert.equal(guide.issues.length, 1);
});

test('rejects an HTML provider error page instead of treating it as an empty guide', () => {
  assert.throws(() => parseEPG('<html><body>Unavailable</body></html>'), /XML parsing error/);
});
