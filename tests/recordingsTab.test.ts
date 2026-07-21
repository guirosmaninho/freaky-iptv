import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

test('expands a recording inside its own card instead of inserting a duplicate player at the top', () => {
  const source = readProjectFile('src/components/RecordingsTab.tsx');

  assert.match(source, /const \[expandedId, setExpandedId\]/);
  assert.match(source, /aria-expanded=\{expandedId === entry\.id\}/);
  assert.match(source, /className="recording-card-details"/);
  assert.match(source, /if \(expandedId === entry\.id && playing\?\.id === entry\.id\)/);
  assert.doesNotMatch(source, /<section className="recording-player"/);
  assert.match(source, /className=\{`recording-card-preview recording-card-preview--\$\{status\}`/);
  assert.match(source, /getRecordingThumbnail\(entry\.id\)/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /aria-label=\{`\$\{expandedId === entry\.id \? 'Close' : 'Play'\}/);
});

test('keeps the recording preview flush with the card and retries short files from the first frame', () => {
  const css = readProjectFile('src/index.css');
  const main = readProjectFile('main.cjs');

  assert.match(css, /\.recording-card-main \{[^}]*justify-content: flex-start;/s);
  assert.match(main, /for \(const seekSeconds of \['2', '0'\]\)/);
});
