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
});
