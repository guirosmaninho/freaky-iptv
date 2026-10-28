/** Normalize text for case- and accent-insensitive substring searches. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
