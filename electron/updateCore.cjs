const PROJECT_OWNER = 'guirosmaninho';
const PROJECT_REPOSITORY = 'freaky-iptv';
const PROJECT_RELEASE_PREFIX = `/${PROJECT_OWNER}/${PROJECT_REPOSITORY}/releases/download/`;
const PORTABLE_ASSET_PATTERN = /^Freaky[ .-]IPTV-(\d+\.\d+\.\d+)-Portable-x64\.exe$/i;
const NSIS_ASSET_PATTERN = /^Freaky[ .-]IPTV-Setup-(\d+\.\d+\.\d+)-x64\.exe$/i;

function parseVersion(value) {
  if (typeof value !== 'string') throw new TypeError('Version must be a string.');
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) throw new TypeError(`Invalid version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

function isTrustedGithubAssetUrl(urlText) {
  try {
    const url = new URL(urlText);
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(PROJECT_RELEASE_PREFIX);
  } catch {
    return false;
  }
}

function isTrustedGithubRedirectUrl(urlText) {
  try {
    const url = new URL(urlText);
    return url.protocol === 'https:' && [
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com'
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

function selectReleaseCandidate(release, currentVersion, target) {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return null;

  let version;
  try {
    version = parseVersion(release.tag_name).join('.');
  } catch {
    return null;
  }
  if (compareVersions(version, currentVersion) <= 0 || !Array.isArray(release.assets)) return null;

  const pattern = target === 'portable' ? PORTABLE_ASSET_PATTERN : target === 'nsis' ? NSIS_ASSET_PATTERN : null;
  if (!pattern) throw new TypeError('Unknown update target.');

  const asset = release.assets.find((candidate) => {
    const match = pattern.exec(candidate?.name || '');
    return match?.[1] === version && isTrustedGithubAssetUrl(candidate.browser_download_url);
  });
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) return null;

  return {
    version,
    notes: typeof release.body === 'string' ? release.body.slice(0, 16 * 1024) : '',
    asset: {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      digest: typeof asset.digest === 'string' ? asset.digest : ''
    }
  };
}

module.exports = {
  PROJECT_OWNER,
  PROJECT_REPOSITORY,
  compareVersions,
  isTrustedGithubAssetUrl,
  isTrustedGithubRedirectUrl,
  parseVersion,
  selectReleaseCandidate
};
