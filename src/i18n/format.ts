// Number formatting that follows the current language.

import { lang, locale } from './lang.ts';

export function num(n: number, digits = 0): string {
  return n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function euros(n: number): string {
  const v = Math.round(n);
  const abs = Math.abs(v).toLocaleString(locale());
  const sign = v < 0 ? '-' : '';
  return lang() === 'fr' ? `${sign}${abs} €` : `${sign}€${abs}`;
}

/** Percentage from a number that is already in 0..100. */
export function pctN(n: number): string {
  const v = Math.round(n);
  return lang() === 'fr' ? `${v} %` : `${v}%`;
}

/** Percentage from a ratio in 0..1. */
export function pct(ratio: number): string {
  return pctN(ratio * 100);
}

/** Plural form: French treats 0 and 1 as singular, English only 1. */
export function plural(n: number, one: string, other: string): string {
  const singular = lang() === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return singular ? one : other;
}

/** Whole seconds, e.g. "12 s". */
export function secs(n: number): string {
  return `${Math.round(n)} s`;
}
