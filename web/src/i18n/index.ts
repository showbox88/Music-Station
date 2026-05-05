/**
 * Tiny i18n system. JSON dictionaries live next to this file; new
 * languages are added by dropping a file and registering it in the
 * `dicts` map below.
 *
 * Usage:
 *   const t = useT();
 *   <span>{t('common.save')}</span>
 *   <span>{t('tracks.no_results', { q: 'foo' })}</span>
 *
 * Keys are dotted paths through the JSON. Missing keys fall back to
 * English; if both are missing, the literal key is returned (helps
 * spot typos during development).
 *
 * The active language is per-user, stored in user_prefs.language and
 * exposed via PrefsContext. A small switcher in the UserMenu lets the
 * user flip between English and Chinese.
 */
import en from './en.json';
import zh from './zh.json';

export type Language = 'en' | 'zh';

export const LANGUAGES: Array<{ code: Language; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
];

const dicts: Record<Language, Record<string, unknown>> = { en, zh };

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  let v: unknown = dict;
  for (const part of key.split('.')) {
    if (v && typeof v === 'object' && part in (v as Record<string, unknown>)) {
      v = (v as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof v === 'string' ? v : undefined;
}

function interpolate(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

export function translate(
  lang: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let s = lookup(dicts[lang], key);
  if (s === undefined && lang !== 'en') {
    s = lookup(dicts.en, key);
  }
  if (s === undefined) return key;
  return vars ? interpolate(s, vars) : s;
}

export function isLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'zh';
}

/**
 * Fallback language used before user prefs have loaded (i.e. on the
 * Login screen) — picks Chinese for `zh-*` browser locales so existing
 * Chinese-speaking users still see Chinese on first visit, otherwise
 * English. After login, prefs.language takes over.
 */
export function detectBrowserLanguage(): Language {
  if (typeof navigator !== 'undefined') {
    const tag = (navigator.language || '').toLowerCase();
    if (tag.startsWith('zh')) return 'zh';
  }
  return 'en';
}
