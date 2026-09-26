// Progression sauvegardée dans le navigateur (localStorage, toujours protégé par try/catch).

import { normalizeConfig, type NetConfig } from '../core/config.ts';
import type { Design } from '../core/design.ts';
import type { LevelDef } from '../core/level.ts';
import { LEVELS } from '../core/levels.ts';
import { spentPoints } from '../core/skills.ts';
import type { SkillId } from '../core/types.ts';

const KEY = 'netarchitect.save.v1';

export interface Best {
  stars: number;
  frustration: number;
  spent: number;
}

export interface SaveData {
  v: 1;
  stars: Record<string, number>;
  best: Record<string, Best>;
  skills: SkillId[];
  plans: Record<string, { design: Design; config: NetConfig }>;
  muted: boolean;
  volume: number;
  seenHelp: boolean;
}

export function freshSave(): SaveData {
  return { v: 1, stars: {}, best: {}, skills: [], plans: {}, muted: false, volume: 0.7, seenHelp: false };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshSave();
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (data.v !== 1) return freshSave();
    return { ...freshSave(), ...data } as SaveData;
  } catch {
    return freshSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Stockage indisponible (navigation privée, aperçu) : la partie continue sans sauvegarde.
  }
}

export function totalStars(save: SaveData): number {
  return Object.values(save.stars).reduce((a, b) => a + b, 0);
}

export function skillPoints(save: SaveData): number {
  return totalStars(save) - spentPoints(save.skills);
}

export function isUnlocked(save: SaveData, level: LevelDef): boolean {
  if (level.order === 1) return true;
  const prev = LEVELS.find((l) => l.order === level.order - 1);
  return !!prev && (save.stars[prev.id] ?? 0) > 0;
}

export const RANKS = ['Stagiaire', 'Technicien support', 'Technicien réseau', 'Administrateur système', 'Ingénieur réseau', 'Architecte réseau', 'Architecte cloud'];

export function currentRank(save: SaveData): string {
  let rank = 0;
  for (const l of LEVELS) if ((save.stars[l.id] ?? 0) > 0) rank = Math.max(rank, l.order + 1);
  return RANKS[Math.min(rank, RANKS.length - 1)];
}

export function planFor(save: SaveData, level: LevelDef): { design: Design; config: NetConfig } | null {
  const p = save.plans[level.id];
  if (!p) return null;
  try {
    return { design: p.design, config: normalizeConfig(level, p.config) };
  } catch {
    return null;
  }
}
