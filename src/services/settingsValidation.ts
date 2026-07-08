const ALLOWED_SOURCE_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_QUALITY_KEYS = new Set(['4K', 'FHD', 'HEVC', 'HD', 'SD', 'Low', 'Backup']);
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_QUERY_KEYS = new Set([
  'password',
  'pass',
  'pwd',
  'token',
  'auth',
  'key',
  'api_key',
  'apikey',
  'username',
  'user'
]);

export const DEFAULT_QUALITY_MAPPINGS: Record<string, string> = {
  '4K': '4k, 2160p, uhd',
  'FHD': 'fhd, 1080p, 1080',
  'HEVC': 'hevc, h265, h.265',
  'HD': 'hd, 720p, 720',
  'SD': 'sd, 576p, 480p, 576, 480',
  'Low': 'low, mobile',
  'Backup': 'backup'
};

export const DEFAULT_APP_BEHAVIOUR = {
  autoRefreshHours: 4,
  autoplayLastChannel: true,
  historyRetentionDays: 365
};

export function validateSourceUrl(value: string, required: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? 'Playlist URL is required.' : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Enter a valid URL.';
  }

  if (!ALLOWED_SOURCE_PROTOCOLS.has(parsed.protocol)) {
    return 'Only HTTP and HTTPS URLs are supported.';
  }

  if (!parsed.hostname) {
    return 'URL must include a host.';
  }

  return null;
}

export function redactSensitiveUrl(value: string): string {
  if (!value.trim()) return '';

  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '***');
      }
    }

    return parsed.toString();
  } catch {
    return value.replace(/([?&](?:user|username|password|pass|token|key)=)[^&]+/gi, '$1***');
  }
}

export function normalizeQualityMappings(input: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  const source = { ...DEFAULT_QUALITY_MAPPINGS, ...(input || {}) };
  for (const [key, value] of Object.entries(source)) {
    if (DANGEROUS_OBJECT_KEYS.has(key) || !SAFE_QUALITY_KEYS.has(key)) {
      continue;
    }

    normalized[key] = value
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .join(', ');
  }

  return normalized;
}

export function findDuplicateQualityKeywords(mappings: Record<string, string>): string[] {
  const owners = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const [quality, value] of Object.entries(mappings || {})) {
    if (DANGEROUS_OBJECT_KEYS.has(quality)) continue;

    for (const rawKeyword of value.split(',')) {
      const keyword = rawKeyword.trim().toLowerCase();
      if (!keyword) continue;

      const owner = owners.get(keyword);
      if (owner && owner !== quality) {
        duplicates.add(keyword);
      } else {
        owners.set(keyword, quality);
      }
    }
  }

  return Array.from(duplicates).sort((a, b) => a.localeCompare(b));
}
