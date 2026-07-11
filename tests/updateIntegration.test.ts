import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

it('keeps application updates manual and confines downloads to trusted GitHub releases', () => {
  const mainSource = readProjectFile('main.cjs');
  const preloadSource = readProjectFile('preload.cjs');
  const typeSource = readProjectFile('src/types.ts');
  const aboutSource = readProjectFile('src/components/AboutTab.tsx');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    version: string;
    dependencies?: Record<string, string>;
    build?: { publish?: Array<{ provider?: string; owner?: string; repo?: string }> };
  };

  assert.equal(packageJson.version, '1.1.0');
  assert.ok(packageJson.dependencies?.['electron-updater']);
  assert.deepEqual(packageJson.build?.publish, [{ provider: 'github', owner: 'guirosmaninho', repo: 'freaky-iptv' }]);
  assert.match(mainSource, /autoDownload\s*=\s*false/);
  assert.match(mainSource, /autoInstallOnAppQuit\s*=\s*false/);
  assert.match(mainSource, /registerTrustedHandle\('check-for-updates'/);
  assert.match(mainSource, /registerTrustedHandle\('download-update'/);
  assert.match(mainSource, /registerTrustedHandle\('install-update'/);
  assert.doesNotMatch(mainSource, /app\.whenReady\(\)\.then\([\s\S]*checkForUpdates\(/);
  assert.match(preloadSource, /checkForUpdates/);
  assert.match(preloadSource, /downloadUpdate/);
  assert.match(preloadSource, /installUpdate/);
  assert.match(preloadSource, /openReleasePage/);
  assert.match(typeSource, /UpdateCheckResult/);
  assert.match(aboutSource, /Procurar atualizações/);
  assert.match(mainSource, /process\.platform === 'darwin'/);
  assert.match(mainSource, /target === 'release-page'/);
  assert.match(mainSource, /openReleasePage\(\)/);
  assert.match(aboutSource, /Abrir Releases no GitHub/);
});

it('requires updater metadata in Windows release verification', () => {
  const verifierSource = readProjectFile('scripts/verify-windows-package.cjs');

  assert.match(verifierSource, /latest\.yml/);
  assert.match(verifierSource, /sha512/);
});
