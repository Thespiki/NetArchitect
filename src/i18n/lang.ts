// Current language and localized-text helpers. DOM-free: shared by the game, the tests and the server.

export type Lang = 'en' | 'fr';

export const LANGS: readonly Lang[] = ['en', 'fr'];

/** Language names, always written in their own language. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', fr: 'Français' };

/** Text written in every supported language (mission content). */
export type Loc = Record<Lang, string>;

let current: Lang = 'en';

export function lang(): Lang {
  return current;
}

/** Internal: use setLang() from index.ts, which also swaps the dictionary. */
export function setCurrentLang(l: Lang): void {
  current = l;
}

export function isLang(x: unknown): x is Lang {
  return x === 'en' || x === 'fr';
}

/** First supported language in a preference list such as navigator.languages. */
export function detectLang(preferences: readonly string[]): Lang {
  for (const p of preferences) {
    const base = p.toLowerCase().slice(0, 2);
    if (isLang(base)) return base;
  }
  return 'en';
}

export function loc(text: Loc | string): string {
  return typeof text === 'string' ? text : text[current];
}

/** Every translation of a text, lowercased: lets the console accept names typed in any language. */
export function allForms(text: Loc | string | undefined): string[] {
  if (!text) return [];
  if (typeof text === 'string') return [text.toLowerCase()];
  return Object.values(text).map((t) => t.toLowerCase());
}

/** Same text in every language (proper nouns, identifiers). */
export function same(text: string): Loc {
  return { en: text, fr: text };
}

export function locale(): string {
  return current === 'fr' ? 'fr-FR' : 'en-US';
}
