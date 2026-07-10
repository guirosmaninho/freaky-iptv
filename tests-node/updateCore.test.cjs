const assert = require('node:assert/strict');
const test = require('node:test');

const {
  compareVersions,
  selectReleaseCandidate,
  isTrustedGithubAssetUrl
} = require('../electron/updateCore.cjs');

const release = ({
  tag = 'v1.0.2',
  prerelease = false,
  draft = false,
  assets = [
    {
      name: 'Freaky IPTV-Setup-1.0.2-x64.exe',
      browser_download_url: 'https://github.com/guirosmaninho/freaky-iptv/releases/download/v1.0.2/Freaky%20IPTV-Setup-1.0.2-x64.exe',
      size: 220_000_000,
      digest: 'sha256:abcdef'
    },
    {
      name: 'Freaky IPTV-1.0.2-Portable-x64.exe',
      browser_download_url: 'https://github.com/guirosmaninho/freaky-iptv/releases/download/v1.0.2/Freaky%20IPTV-1.0.2-Portable-x64.exe',
      size: 220_000_000,
      digest: 'sha256:abcdef'
    }
  ]
} = {}) => ({ tag_name: tag, prerelease, draft, assets, body: 'Release notes' });

test('compares semantic app versions without accepting malformed tags', () => {
  assert.equal(compareVersions('1.0.1', '1.0.2'), -1);
  assert.equal(compareVersions('1.2.0', '1.1.99'), 1);
  assert.equal(compareVersions('1.0.1', 'v1.0.1'), 0);
  assert.throws(() => compareVersions('1.0', '1.0.1'), /version/i);
});

test('selects the newer stable portable asset from the release', () => {
  const candidate = selectReleaseCandidate(release(), '1.0.1', 'portable');

  assert.deepEqual(candidate, {
    version: '1.0.2',
    notes: 'Release notes',
    asset: {
      name: 'Freaky IPTV-1.0.2-Portable-x64.exe',
      url: 'https://github.com/guirosmaninho/freaky-iptv/releases/download/v1.0.2/Freaky%20IPTV-1.0.2-Portable-x64.exe',
      size: 220_000_000,
      digest: 'sha256:abcdef'
    }
  });
});

test('selects the hyphenated asset names emitted by electron-builder update metadata', () => {
  const candidate = selectReleaseCandidate(release({
    assets: [{
      name: 'Freaky-IPTV-1.0.2-Portable-x64.exe',
      browser_download_url: 'https://github.com/guirosmaninho/freaky-iptv/releases/download/v1.0.2/Freaky-IPTV-1.0.2-Portable-x64.exe',
      size: 220_000_000,
      digest: 'sha256:abcdef'
    }]
  }), '1.0.1', 'portable');

  assert.equal(candidate?.asset.name, 'Freaky-IPTV-1.0.2-Portable-x64.exe');
});
test('does not select drafts, prereleases, current versions, or releases without the requested asset', () => {
  assert.equal(selectReleaseCandidate(release({ draft: true }), '1.0.1', 'portable'), null);
  assert.equal(selectReleaseCandidate(release({ prerelease: true }), '1.0.1', 'portable'), null);
  assert.equal(selectReleaseCandidate(release({ tag: 'v1.0.1' }), '1.0.1', 'portable'), null);
  assert.equal(selectReleaseCandidate(release({ assets: [] }), '1.0.1', 'portable'), null);
});

test('only accepts release asset URLs from the project GitHub release endpoint', () => {
  assert.equal(isTrustedGithubAssetUrl('https://github.com/guirosmaninho/freaky-iptv/releases/download/v1.0.2/update.exe'), true);
  assert.equal(isTrustedGithubAssetUrl('https://example.test/update.exe'), false);
  assert.equal(isTrustedGithubAssetUrl('http://github.com/guirosmaninho/freaky-iptv/releases/download/v1.0.2/update.exe'), false);
});
