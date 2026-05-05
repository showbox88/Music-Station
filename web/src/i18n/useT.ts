/**
 * useT hook — pulls the active language from PrefsContext and returns a
 * stable t(key, vars?) function. Memoized on language so re-renders are
 * cheap.
 */
import { useCallback } from 'react';
import { usePrefs } from '../PrefsContext';
import { translate, isLanguage, detectBrowserLanguage, type Language } from './index';

export function useLanguage(): Language {
  const { prefs } = usePrefs();
  if (isLanguage(prefs.language)) return prefs.language;
  // Pre-auth (Login) or never-set: detect from browser locale so users
  // get Chinese on a zh-* system out of the box.
  return detectBrowserLanguage();
}

export function useT() {
  const lang = useLanguage();
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
}
