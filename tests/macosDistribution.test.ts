import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const readProjectFile = (fileName: string) => readFileSync(join(process.cwd(), fileName), 'utf8');

describe('macOS distribution contract', () => {
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    scripts: Record<string, string>;
    build: {
      mac?: {
        icon?: string;
        forceCodeSigning?: boolean;
        artifactName?: string;
        target?: string;
      };
      dmg?: {
        background?: string;
        contents?: Array<{ type?: string; path?: string; x?: number; y?: number }>;
      };
    };
  };

  it('builds unsigned, architecture-specific macOS DMGs', () => {
    assert.equal(packageJson.build.mac?.target, 'dmg');
    assert.equal(packageJson.build.mac?.forceCodeSigning, false);
    assert.equal(packageJson.build.mac?.icon, 'build-resources/cat_icon.icns');
    assert.equal(packageJson.build.mac?.artifactName, 'Freaky-IPTV-${version}-mac-${arch}.${ext}');
    assert.equal(packageJson.build.dmg?.background, 'build-resources/dmg-background.png');
    assert.deepEqual(packageJson.build.dmg?.contents?.map(({ type, path, x, y }) => ({ type, path, x, y })), [
      { type: 'file', path: undefined, x: 130, y: 220 },
      { type: 'link', path: '/Applications', x: 410, y: 220 }
    ]);
    assert.match(packageJson.scripts['build:mac:x64'], /darwin-x64/);
    assert.match(packageJson.scripts['build:mac:arm64'], /darwin-arm64/);
    assert.match(packageJson.scripts['package:mac:x64'], /electron-builder --mac --x64/);
    assert.match(packageJson.scripts['package:mac:arm64'], /electron-builder --mac --arm64/);
    assert.match(packageJson.scripts['release:mac'], /verify:package:mac/);
  });

  it('provides an authenticated command to trigger the multi-platform release workflow', () => {
    assert.match(packageJson.scripts['release:all'], /trigger-github-release\.cjs/);
    const triggerSource = readProjectFile('scripts/trigger-github-release.cjs');
    const workflowSource = readProjectFile('.github/workflows/release.yml');
    assert.match(triggerSource, /gh.*auth.*status/s);
    assert.match(triggerSource, /workflow.*run.*release\.yml/s);
    assert.match(workflowSource, /workflow_dispatch/);
    assert.match(workflowSource, /macos-15-intel/);
    assert.match(workflowSource, /macos-15/);
    assert.match(workflowSource, /windows-latest/);
  });
});
