// Translations: `T` always points to the dictionary of the current language.
// ES modules export live bindings, so `import { T }` sees the new dictionary after setLang().

import { en, type Dict } from './en.ts';
import { fr } from './fr.ts';
import { setCurrentLang, type Lang } from './lang.ts';

export type { Dict } from './en.ts';
export * from './format.ts';
export * from './lang.ts';

const DICTS: Record<Lang, Dict> = { en, fr };

export let T: Dict = en;

export function setLang(l: Lang): void {
  setCurrentLang(l);
  T = DICTS[l];
}
