import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

describe('Windows distribution contract', () => {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    name: string;
    version: string;
    author?: string | { name?: string };
    scripts: Record<string, string>;
    build: {
      appId: string;
      productName: string;
      executableName?: string;
      electronDist?: string;
      asarUnpack: string[];
      files: string[];
      win: {
        icon?: string;
        forceCodeSigning?: boolean;
        target: Array<{ target: string; arch: string[] }>;
      };
      nsis?: {
        artifactName?: string;
        oneClick?: boolean;
        allowToChangeInstallationDirectory?: boolean;
        createDesktopShortcut?: boolean | 'always';
        createStartMenuShortcut?: boolean;
        deleteAppDataOnUninstall?: boolean;
      };
      portable?: { artifactName?: string };
    };
  };

  it('publishes both native helpers as self-contained Windows x64 runtimes', () => {
    assert.match(packageJson.scripts['build:dpapi-helper'], /-r win-x64/);
    assert.match(packageJson.scripts['build:dpapi-helper'], /--self-contained true/);
    assert.match(packageJson.scripts['build:dpapi-helper'], /-o native-runtime\/win-x64\/dpapi/);
    assert.match(packageJson.scripts['build:libvlc-proxy'], /-r win-x64/);
    assert.match(packageJson.scripts['build:libvlc-proxy'], /--self-contained true/);
    assert.ok(packageJson.build.files.includes('native-runtime-package/**'));
    assert.ok(packageJson.build.asarUnpack.includes('native-runtime-package/**'));

    const mainSource = readProjectFile('main.cjs');
    assert.match(mainSource, /getNativeRuntimePath\('dpapi', 'dpapi-helper\.exe'\)/);
    assert.match(mainSource, /getNativeRuntimePath\('libvlc-proxy', executableName\)/);
  });

  it('builds branded x64 portable and assisted-installer artifacts', () => {
    assert.equal(packageJson.name, 'freaky-iptv');
    assert.equal(packageJson.version, '1.0.1');
    assert.equal(typeof packageJson.author === 'string' ? packageJson.author : packageJson.author?.name, 'Freaky IPTV');
    assert.equal(packageJson.build.appId, 'com.guiro.freakyiptv');
    assert.equal(packageJson.build.productName, 'Freaky IPTV');
    assert.equal(packageJson.build.executableName, 'Freaky IPTV');
    assert.equal(packageJson.build.win.icon, 'build-resources/cat_icon.ico');
    assert.equal(packageJson.scripts.build, 'npm run build:win');
    assert.match(packageJson.scripts['build:win'], /npm run prepare:windows-icon/);
    assert.match(packageJson.scripts['prepare:windows-icon'], /create-windows-icon\.cjs/);
    assert.deepEqual(packageJson.build.win.target, [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ]);
    assert.equal(packageJson.build.win.forceCodeSigning, false);
    assert.equal(packageJson.build.nsis?.oneClick, false);
    assert.equal(packageJson.build.nsis?.artifactName, 'Freaky-IPTV-Setup-${version}-${arch}.${ext}');
    assert.equal(packageJson.build.portable?.artifactName, 'Freaky-IPTV-${version}-Portable-${arch}.${ext}');
    assert.equal(packageJson.build.nsis?.allowToChangeInstallationDirectory, true);
    assert.equal(packageJson.build.nsis?.createDesktopShortcut, true);
    assert.equal(packageJson.build.nsis?.createStartMenuShortcut, true);
    assert.equal(packageJson.build.nsis?.deleteAppDataOnUninstall, false);
  });

  it('provides a package verification command and signing instructions', () => {
    assert.match(packageJson.scripts['verify:package:win'], /verify-windows-package\.cjs/);
    assert.match(packageJson.scripts['release:win'], /npm test/);
    assert.match(packageJson.scripts['release:win'], /npm run lint/);
    assert.match(packageJson.scripts['release:win'], /npm run build/);
    assert.match(packageJson.scripts['release:win'], /playwright test/);
    assert.match(packageJson.scripts['release:win'], /electron-builder --win/);
    assert.match(packageJson.scripts['release:win'], /npm run verify:package:win/);
    const documentation = readProjectFile('DISTRIBUTION.md');
    assert.match(documentation, /CSC_LINK/);
    assert.match(documentation, /CSC_KEY_PASSWORD/);
    assert.match(documentation, /Windows limpo/i);
  });

  it('provides a single Windows release entry point', () => {
    const releaseCommand = readProjectFile('build-windows-release.cmd');
    assert.match(releaseCommand, /npm\.cmd ci/);
    assert.match(releaseCommand, /npm\.cmd run release:win/);
    assert.match(releaseCommand, /where node/);
    assert.match(releaseCommand, /where dotnet/);
  });

  it('keeps packaged smoke tests isolated from GPU and real user data', () => {
    const mainSource = readProjectFile('main.cjs');
    assert.match(mainSource, /if \(process\.env\.FREAKYIPTV_E2E === '1'\) \{\s*app\.disableHardwareAcceleration\(\)/);
    assert.match(mainSource, /process\.env\.FREAKYIPTV_E2E === '1'\s*\? \{ migrated: false/);

    const verifierSource = readProjectFile('scripts/verify-windows-package.cjs');
    assert.match(verifierSource, /process\.env\.CODEX_CI/);
    assert.match(verifierSource, /GPU process isn't usable/);
  });

  it('preserves the standard backdrop-filter declaration in production CSS', () => {
    const viteConfig = readProjectFile('vite.config.ts');
    assert.match(viteConfig, /cssMinify:\s*false/);
  });
});
