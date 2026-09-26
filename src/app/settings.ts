// Device settings: language, sound and game server address. They stay on this device and are
// never synced (each device keeps its own language and volume).

import { detectLang, isLang, type Lang } from '../i18n/index.ts';

const KEY = 'netarchitect.settings.v1';

export interface Settings {
  lang: Lang;
  muted: boolean;
  volume: number;
  /** Game server chosen in the settings; empty means the default one. */
  server: string;
}

function browserLanguages(): string[] {
  try {
    return [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  } catch {
    return [];
  }
}

export function loadSettings(legacy: { muted?: boolean; volume?: number } = {}): Settings {
  const fallback: Settings = {
    lang: detectLang(browserLanguages()),
    muted: legacy.muted ?? false,
    volume: legacy.volume ?? 0.7,
    server: '',
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const d = JSON.parse(raw) as Partial<Settings>;
    return {
      lang: isLang(d.lang) ? d.lang : fallback.lang,
      muted: typeof d.muted === 'boolean' ? d.muted : fallback.muted,
      volume: typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1 ? d.volume : fallback.volume,
      server: typeof d.server === 'string' ? d.server : '',
    };
  } catch {
    return fallback;
  }
}

export function writeSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private browsing, previews): settings last for this session only.
  }
}
