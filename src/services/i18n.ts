import type { ptPtCatalogue } from './i18nCatalogue';

export type SupportedLocale = 'en-US' | 'pt-PT';
export type LanguagePreference = 'system' | 'en' | 'pt-PT';
export type TranslationParams = Record<string, string | number>;
export type TranslationKey = keyof typeof ptPtCatalogue;

const systemLanguages = (): readonly string[] =>
  typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];

export function resolveAppLocale(preference: LanguagePreference, languages: readonly string[] = systemLanguages()): SupportedLocale {
  if (preference === 'en') return 'en-US';
  if (preference === 'pt-PT') return 'pt-PT';
  for (const language of languages) {
    if (/^pt(?:-|$)/i.test(language)) return 'pt-PT';
    if (/^en(?:-|$)/i.test(language)) return 'en-US';
  }
  return 'en-US';
}

let languagePreference: LanguagePreference = 'system';
let committedLocale: SupportedLocale = 'en-US';
const listeners = new Set<() => void>();
let revision = 0;
export const getLanguageRevision = () => revision;
const notifyLanguage = () => { revision++; for (const listener of listeners) listener(); };
let catalogue: Readonly<Record<string, string>> = {};
let cataloguePromise: Promise<void> | null = null;
let dynamicMessages: Array<{ pattern: RegExp; names: string[]; target: string; specificity: number }> = [];
const ensureCatalogue = () => cataloguePromise ||= import('./i18nCatalogue').then(module => {
  catalogue = module.ptPtCatalogue;
  dynamicMessages = buildDynamicMessages(catalogue);
}).catch(error => { cataloguePromise = null; throw error; });
export const getLocale = (): SupportedLocale => committedLocale;
export const getAppLanguage = (): LanguagePreference => languagePreference;

let languageRequest = 0;
export async function setAppLanguage(preference: LanguagePreference): Promise<void> {
  const request = ++languageRequest;
  // Publish locale and translations together so locale-keyed derived data is ready.
  const locale = resolveAppLocale(preference);
  if (locale === 'pt-PT') await ensureCatalogue();
  if (request !== languageRequest || (languagePreference === preference && committedLocale === locale)) return;
  languagePreference = preference;
  committedLocale = locale;
  notifyLanguage();
}

const onSystemLanguageChange = () => {
  if (languagePreference !== 'system') return;
  void setAppLanguage('system').catch(() => {});
};

export function subscribeLanguage(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('languagechange', onSystemLanguageChange);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('languagechange', onSystemLanguageChange);
  };
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildDynamicMessages = (catalogue: Readonly<Record<string, string>>) => Object.entries(catalogue).flatMap(([source, target]) => {
  const names: string[] = [];
  const parts: string[] = [];
  let offset = 0;
  for (const match of source.matchAll(/\{(\w+)\}/g)) {
    parts.push(escapeRegex(source.slice(offset, match.index)), '(.+?)');
    names.push(match[1]);
    offset = match.index + match[0].length;
  }
  if (!names.length) return [];
  parts.push(escapeRegex(source.slice(offset)));
  return [{ pattern: new RegExp(`^${parts.join('')}$`), names, target, specificity: source.replace(/\{\w+\}/g, '').length }];
}).sort((left, right) => right.specificity - left.specificity);

const interpolate = (text: string, params: TranslationParams): string =>
  text.replace(/\{(\w+)\}/g, (placeholder, name: string) => Object.hasOwn(params, name) ? String(params[name]) : placeholder);

/** Translate application copy only. Provider channel/programme names remain interpolation values. */
export function translate(text: string, locale: string = getLocale(), params: TranslationParams = {}): string {
  if (!/^pt(?:-|$)/i.test(locale)) return interpolate(text, params);
  if (Object.hasOwn(catalogue, text)) return interpolate(catalogue[text], params);
  if (text.includes('\n')) return text.split('\n').map(line => translate(line, locale, params)).join('\n');
  // Host status messages may already contain a version, count or error detail.
  // Match only complete known application templates; unknown diagnostics stay intact.
  for (const message of dynamicMessages) {
    const match = message.pattern.exec(text);
    if (!match) continue;
    const values = Object.fromEntries(message.names.map((name, index) => [name, match[index + 1]]));
    return interpolate(message.target, { ...values, ...params });
  }
  return interpolate(text, params);
}
