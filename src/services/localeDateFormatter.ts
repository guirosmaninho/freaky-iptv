import { getLocale } from './i18n';

/** Cache each fixed format per locale and pick up language changes on use. */
export function localeDateFormatter(options: Intl.DateTimeFormatOptions, englishLocale = 'en-US') {
  const formatters = new Map<string, Intl.DateTimeFormat>();
  return { format(value: Date | number): string {
    const locale = getLocale() === 'pt-PT' ? 'pt-PT' : englishLocale;
    let formatter = formatters.get(locale);
    if (!formatter) { formatter = new Intl.DateTimeFormat(locale, options); formatters.set(locale, formatter); }
    return formatter.format(value);
  } };
}
