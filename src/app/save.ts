// Player progress, kept in the browser (localStorage, always behind try/catch) and synced with
// the game server when the player is signed in.

import { T } from '../i18n/index.ts';
import { normalizeConfig, type NetConfig } from '../core/config.ts';
import type { Design } from '../core/design.ts';
import type { LevelDef } from '../core/level.ts';
import { CAMPAIGN, levelById } from '../core/levels.ts';
import type { RunRecord } from '../core/run.ts';
import { SKILLS, spentPoints } from '../core/skills.ts';
import type { SkillId } from '../core/types.ts';

const KEY = 'netarchitect.save.v2';
const KEY_V1 = 'netarchitect.save.v1';

export interface Best {
  stars: number;
  score: number;
  frustration: number;
  spent: number;
  /** Replay of this result, sent to the server so that it can verify the score. */
  run?: RunRecord;
  /** The server replayed the run and confirmed the score. */
  verified?: boolean;
  /** The server refused the run: it is not submitted again. */
  rejected?: boolean;
}

export interface Plan {
  design: Design;
  config: NetConfig;
  /** Last edit (ms), to merge two saves. */
  at: number;
}

export interface SaveData {
  v: 2;
  stars: Record<string, number>;
  best: Record<string, Best>;
  skills: SkillId[];
  /** Last change to the skills (ms), to merge two saves. */
  skillsAt: number;
  plans: Record<string, Plan>;
  training: 'done' | 'skipped' | null;
  seenHelp: boolean;
  updatedAt: number;
}

export function freshSave(): SaveData {
  return { v: 2, stars: {}, best: {}, skills: [], skillsAt: 0, plans: {}, training: null, seenHelp: false, updatedAt: 0 };
}

// ---------------------------------------------------------------------------
// Reading and repairing saves (local or downloaded)

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, fallback = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id));

/** Builds a valid save from anything that looks like one; unknown fields are dropped. */
export function coerceSave(raw: unknown): SaveData {
  const save = freshSave();
  if (!isObj(raw)) return save;
  if (isObj(raw.stars)) {
    for (const [id, n] of Object.entries(raw.stars)) if (levelById(id)) save.stars[id] = Math.max(0, Math.min(3, Math.round(num(n))));
  }
  if (isObj(raw.best)) {
    for (const [id, b] of Object.entries(raw.best)) {
      if (!levelById(id) || !isObj(b)) continue;
      save.best[id] = {
        stars: num(b.stars),
        score: num(b.score),
        frustration: num(b.frustration),
        spent: num(b.spent),
        run: isObj(b.run) ? (b.run as unknown as RunRecord) : undefined,
        verified: b.verified === true || undefined,
        rejected: b.rejected === true || undefined,
      };
    }
  }
  if (Array.isArray(raw.skills)) save.skills = [...new Set(raw.skills.filter((s): s is SkillId => typeof s === 'string' && SKILL_IDS.has(s)))];
  save.skillsAt = num(raw.skillsAt);
  if (isObj(raw.plans)) {
    for (const [id, p] of Object.entries(raw.plans)) {
      if (!levelById(id) || !isObj(p) || !isObj(p.design) || !isObj(p.config)) continue;
      save.plans[id] = { design: p.design as unknown as Design, config: p.config as unknown as NetConfig, at: num(p.at) };
    }
  }
  save.training = raw.training === 'done' || raw.training === 'skipped' ? raw.training : null;
  save.seenHelp = raw.seenHelp === true;
  save.updatedAt = num(raw.updatedAt);
  return save;
}

// Identifiers renamed when the game became bilingual (version 1 saves).
const RENAMED: Record<string, string> = { fai: 'isp', compta: 'acct', rushs: 'rushes' };
const renameId = (id: string): string => RENAMED[id] ?? id.replace(/^cp-(\d+)$/, 'ac-$1');

function migratePlan(plan: Obj): Obj {
  const design = isObj(plan.design) ? plan.design : {};
  const config = isObj(plan.config) ? plan.config : {};
  const cables = Array.isArray(design.cables) ? design.cables.filter(isObj) : [];
  const rename = (m: unknown) => (isObj(m) ? Object.fromEntries(Object.entries(m).map(([k, v]) => [renameId(k), v])) : {});
  return {
    design: { ...design, cables: cables.map((c) => ({ ...c, a: renameId(String(c.a)), b: renameId(String(c.b)) })) },
    config: {
      ...config,
      vlans: rename(config.vlans),
      lb: rename(config.lb),
      rules: (Array.isArray(config.rules) ? config.rules.filter(isObj) : []).map((r) => ({ ...r, src: renameId(String(r.src)), dst: renameId(String(r.dst)) })),
      quarantine: [],
    },
    at: 0,
  };
}

/** Version 1 (French-only prototype) → version 2. Returns the old sound settings too. */
export function migrateV1(raw: unknown): { save: SaveData; muted?: boolean; volume?: number } {
  if (!isObj(raw)) return { save: freshSave() };
  const plans = isObj(raw.plans) ? Object.fromEntries(Object.entries(raw.plans).filter(([, p]) => isObj(p)).map(([id, p]) => [id, migratePlan(p as Obj)])) : {};
  const save = coerceSave({ ...raw, plans, skillsAt: 0 });
  // Older bests have no score: the next successful day will set one.
  for (const b of Object.values(save.best)) b.score = 0;
  if (Object.values(save.stars).some((n) => n > 0)) save.training = 'skipped';
  return { save, muted: typeof raw.muted === 'boolean' ? raw.muted : undefined, volume: typeof raw.volume === 'number' ? raw.volume : undefined };
}

export function loadSave(): { save: SaveData; legacy: { muted?: boolean; volume?: number } } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { save: coerceSave(JSON.parse(raw)), legacy: {} };
    const old = localStorage.getItem(KEY_V1);
    if (old) {
      const { save, muted, volume } = migrateV1(JSON.parse(old));
      return { save, legacy: { muted, volume } };
    }
  } catch {
    // Corrupted or unavailable storage: start fresh.
  }
  return { save: freshSave(), legacy: {} };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private browsing, previews): the game goes on without saving.
  }
}

// ---------------------------------------------------------------------------
// Progress

/** Stars of the campaign (training excluded): one skill point each. */
export function totalStars(save: SaveData): number {
  return CAMPAIGN.reduce((sum, l) => sum + (save.stars[l.id] ?? 0), 0);
}

export function maxStars(): number {
  return CAMPAIGN.length * 3;
}

export function skillPoints(save: SaveData): number {
  return totalStars(save) - spentPoints(save.skills);
}

/** Sum of the best score of each campaign mission: decides the tier. */
export function totalScore(save: SaveData): number {
  return CAMPAIGN.reduce((sum, l) => sum + (save.best[l.id]?.score ?? 0), 0);
}

export function isUnlocked(save: SaveData, level: LevelDef): boolean {
  if (level.order === 0) return true;
  if (level.order === 1) return save.training !== null || (save.stars[level.id] ?? 0) > 0;
  const prev = CAMPAIGN.find((l) => l.order === level.order - 1);
  return !!prev && (save.stars[prev.id] ?? 0) > 0;
}

/** Index in T.ranks: intern, then the rank of the next mission to play. */
export function rankIndex(save: SaveData): number {
  let rank = save.training ? 1 : 0;
  for (const l of CAMPAIGN) if ((save.stars[l.id] ?? 0) > 0) rank = Math.max(rank, l.order + 1);
  return Math.min(rank, T.ranks.length - 1);
}

export function currentRank(save: SaveData): string {
  return T.ranks[rankIndex(save)];
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

// ---------------------------------------------------------------------------
// Merging two saves (this device and the server)

function better(a: Best | undefined, b: Best | undefined): Best | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (!!a.verified !== !!b.verified) return a.verified ? a : b;
  return a.stars >= b.stars ? a : b;
}

/** Keeps the best of both: stars and scores never go down, the latest skills and plans win. */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const out = freshSave();
  for (const id of new Set([...Object.keys(a.stars), ...Object.keys(b.stars)])) {
    out.stars[id] = Math.max(a.stars[id] ?? 0, b.stars[id] ?? 0);
  }
  for (const id of new Set([...Object.keys(a.best), ...Object.keys(b.best)])) {
    const best = better(a.best[id], b.best[id]);
    if (best) out.best[id] = best;
  }
  for (const id of new Set([...Object.keys(a.plans), ...Object.keys(b.plans)])) {
    const pa = a.plans[id];
    const pb = b.plans[id];
    out.plans[id] = !pa ? pb : !pb ? pa : pb.at > pa.at ? pb : pa;
  }
  const latest = b.skillsAt > a.skillsAt ? b : a;
  out.skills = [...latest.skills];
  out.skillsAt = latest.skillsAt;
  // Never spend more points than the merged stars allow.
  while (out.skills.length && spentPoints(out.skills) > totalStars(out)) out.skills.pop();
  out.skills = out.skills.filter((s) => SKILLS.find((d) => d.id === s)!.requires.every((r) => out.skills.includes(r)));
  const rank = { done: 2, skipped: 1 } as const;
  const ta = a.training ? rank[a.training] : 0;
  const tb = b.training ? rank[b.training] : 0;
  out.training = ta >= tb ? a.training : b.training;
  out.seenHelp = a.seenHelp || b.seenHelp;
  out.updatedAt = Math.max(a.updatedAt, b.updatedAt);
  return out;
}

/** Same progress (ignores timestamps): used to skip useless uploads. */
export function sameProgress(a: SaveData, b: SaveData): boolean {
  const strip = (s: SaveData) => JSON.stringify({ ...s, updatedAt: 0 });
  return strip(a) === strip(b);
}
