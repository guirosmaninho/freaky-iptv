import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';

function sourceTest(guideError: Error | null = null) {
  const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const callback = source.match(/const handleTestSources = async \([\s\S]*?\n {2}\};/)?.[0];
  assert.ok(callback);
  const code = ts.transpileModule(callback + '\nexport { handleTestSources };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
  const exports: { handleTestSources?: (playlist: string, guide: string) => Promise<string> } = {};
  new Function('exports', 'validateSourceUrl', 'setStatusText', 'downloadAndParseM3U', 'downloadAndParseEPG', 'countEpgPrograms', 't', code)(
    exports, () => null, () => {}, async () => ({ channels: [{}, {}] }),
    async () => { if (guideError) throw guideError; return { programsByChannel: { news: [{}, {}, {}] } }; },
    (programs: Record<string, unknown[]>) => Object.values(programs).reduce((sum, entries) => sum + entries.length, 0),
    (message: string, params: Record<string, unknown> = {}) => message.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? `{${key}}`))
  );
  return exports.handleTestSources!;
}

it('identifies a working playlist when the guide response is invalid', async () => {
  await assert.rejects(sourceTest(new Error('XML parsing error: upstream-token'))('playlist', 'guide'), error => {
    assert.equal((error as Error).message, 'Playlist connected: 2 channels. The TV guide source returned invalid XMLTV.');
    return true;
  });
});

it('reports only the playlist when no optional guide is configured', async () => {
  assert.equal(await sourceTest()('playlist', ''), 'Playlist connected: 2 channels.');
});

it('keeps provider details out of guide download failures', async () => {
  await assert.rejects(sourceTest(new Error('Network failure containing private provider details'))('playlist', 'guide'), error => {
    assert.equal((error as Error).message, 'Playlist connected: 2 channels. The TV guide could not be downloaded.');
    return true;
  });
});

it('reports successful counts for both sources', async () => {
  assert.equal(await sourceTest()('playlist', 'guide'), 'Sources connected: 2 channels, 3 programmes.');
});
