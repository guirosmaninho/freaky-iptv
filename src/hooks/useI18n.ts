import { useCallback, useSyncExternalStore } from 'react';
import { getLocale, getLanguageRevision, subscribeLanguage, translate, type TranslationParams } from '../services/i18n';

export function useI18n() {
  const revision = useSyncExternalStore(subscribeLanguage, getLanguageRevision, getLanguageRevision);
  const locale = getLocale();
  const t = useCallback((text: string, params?: TranslationParams) => { void revision; return translate(text, locale, params); }, [locale, revision]);
  return { t, locale };
}
