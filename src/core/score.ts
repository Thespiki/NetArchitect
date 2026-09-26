// Mission score and ranking tiers.
// A successful day scores up to 2,900 points: completion, bonus stars, then three measures of
// quality (user satisfaction, reliability, money saved). A lost day scores nothing.

import type { LevelDef } from './level.ts';
import type { MissionResult } from './objectives.ts';

export const SCORE = {
  completion: 1000,
  perStar: 250,
  satisfaction: 600,
  reliability: 400,
  savings: 400,
  /** Loss rate at which the reliability bonus reaches zero. */
  lossCeiling: 0.2,
  /** Share of the budget saved that earns the full savings bonus. */
  savingsTarget: 0.5,
};

export const MAX_MISSION_SCORE = SCORE.completion + 2 * SCORE.perStar + SCORE.satisfaction + SCORE.reliability + SCORE.savings;

export interface ScoreBreakdown {
  completion: number;
  stars: number;
  satisfaction: number;
  reliability: number;
  savings: number;
  total: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function missionScore(level: LevelDef, result: MissionResult): ScoreBreakdown {
  if (!result.success) return { completion: 0, stars: 0, satisfaction: 0, reliability: 0, savings: 0, total: 0 };
  const completion = SCORE.completion;
  const stars = SCORE.perStar * Math.max(0, result.stars - 1);
  const calm = 1 - clamp01(result.avgFrustration / 100);
  const satisfaction = Math.round(SCORE.satisfaction * calm * calm);
  const reliability = Math.round(SCORE.reliability * clamp01(1 - result.lossRate / SCORE.lossCeiling));
  const saved = level.budget > 0 ? (level.budget - result.spent) / level.budget : 0;
  const savings = Math.round(SCORE.savings * clamp01(saved / SCORE.savingsTarget));
  return { completion, stars, satisfaction, reliability, savings, total: completion + stars + satisfaction + reliability + savings };
}

// ---------------------------------------------------------------------------
// Tiers: the sum of the best score of each campaign mission (5 missions, 14,500 at most).
// The reference solutions of the test suite reach about 13,200: Diamond. Legend asks for better.

export type TierId = 'unranked' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend';

export interface Tier {
  id: TierId;
  min: number;
  color: string;
}

export const TIERS: Tier[] = [
  { id: 'unranked', min: 0, color: '#7f8aa3' },
  { id: 'bronze', min: 1, color: '#d08a4e' },
  { id: 'silver', min: 3500, color: '#c3ccd9' },
  { id: 'gold', min: 7000, color: '#f3c64d' },
  { id: 'platinum', min: 10000, color: '#6fe3d6' },
  { id: 'diamond', min: 12000, color: '#8fb8ff' },
  { id: 'legend', min: 13500, color: '#ff6fd8' },
];

export function tierFor(total: number): Tier {
  let tier = TIERS[0];
  for (const t of TIERS) if (total >= t.min) tier = t;
  return tier;
}

/** Next tier and how far the player is from it (null at the top). */
export function nextTier(total: number): { tier: Tier; missing: number; progress: number } | null {
  const current = tierFor(total);
  const idx = TIERS.indexOf(current);
  const next = TIERS[idx + 1];
  if (!next) return null;
  const span = next.min - current.min;
  return { tier: next, missing: next.min - total, progress: span > 0 ? clamp01((total - current.min) / span) : 0 };
}
