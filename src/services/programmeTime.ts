const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatProgrammeTime(isoString: string, locale: string): string {
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return '';
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    formatters.set(locale, formatter);
  }
  return formatter.format(date);
}
