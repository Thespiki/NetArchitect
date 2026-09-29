// Run records: everything needed to replay a day exactly (design, starting configuration,
// skills and the player's timed actions). The server replays them to verify leaderboard scores,
// so validation assumes the record may have been forged.

import { CABLES, DEVICES } from './catalog.ts';
import { cloneConfig, parseSelector, type FwRule, type NetConfig, type RateLimit } from './config.ts';
import { availableKit, designCost, isEquipment, nodeRef, type Design } from './design.ts';
import { hasFeature, type LevelDef } from './level.ts';
import { levelById } from './levels.ts';
import { buildNetwork } from './network.ts';
import { evaluate, type MissionResult } from './objectives.ts';
import { missionScore, type ScoreBreakdown } from './score.ts';
import { Simulation, STEP, type SimAction } from './simulation.ts';
import { SKILLS } from './skills.ts';
import type { CableKind, EquipmentKind, LbMode, SkillId } from './types.ts';

/** Bump when the simulation rules change: older records can no longer be replayed faithfully. */
export const SIM_VERSION = 1;

export interface RunRecord {
  v: number;
  level: string;
  design: Design;
  config: NetConfig;
  skills: SkillId[];
  actions: SimAction[];
}

export const LIMITS = {
  devices: 80,
  cables: 300,
  rules: 64,
  rateLimits: 16,
  actions: 2000,
  text: 40,
};

export function recordRun(level: LevelDef, design: Design, sim: Simulation): RunRecord {
  return {
    v: SIM_VERSION,
    level: level.id,
    design: { devices: design.devices.map((d) => ({ ...d })), cables: design.cables.map((c) => ({ ...c })), seq: design.seq },
    config: cloneConfig(sim.initialConfig),
    skills: [...sim.skills].sort(),
    actions: sim.actions.map((a) => (a.kind === 'config' ? { ...a, config: cloneConfig(a.config) } : { ...a })),
  };
}

// ---------------------------------------------------------------------------
// Validation

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const isStr = (x: unknown, max = LIMITS.text): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

class Invalid extends Error {}

function check(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Invalid(what);
}

const SKILL_IDS = new Set<string>(SKILLS.map((s) => s.id));
const EQUIPMENT = new Set<string>(Object.keys(DEVICES));
const CABLE_KINDS = new Set<string>(Object.keys(CABLES));

function validateSkills(raw: unknown): SkillId[] {
  check(Array.isArray(raw) && raw.length <= SKILLS.length, 'skills');
  const out = new Set<SkillId>();
  for (const s of raw) {
    check(typeof s === 'string' && SKILL_IDS.has(s), 'skill');
    out.add(s as SkillId);
  }
  // Prerequisites must be owned too.
  for (const s of out) check(SKILLS.find((d) => d.id === s)!.requires.every((r) => out.has(r)), 'skill prerequisites');
  return [...out].sort();
}

function validateDesign(level: LevelDef, raw: unknown, skills: ReadonlySet<SkillId>): Design {
  check(isObj(raw), 'design');
  const { devices, cables, seq } = raw;
  check(Array.isArray(devices) && devices.length <= LIMITS.devices, 'devices');
  check(Array.isArray(cables) && cables.length <= LIMITS.cables, 'cables');
  check(isInt(seq, 1, 1_000_000), 'design seq');
  const kit = availableKit(level, skills);
  const design: Design = { devices: [], cables: [], seq };
  const taken = new Set(level.endpoints.map((e) => `${e.x},${e.y}`));
  const ids = new Set(level.endpoints.map((e) => e.id));
  for (const d of devices) {
    check(isObj(d), 'device');
    const { id, kind, x, y } = d;
    check(typeof kind === 'string' && EQUIPMENT.has(kind) && kit.equipment.has(kind as EquipmentKind), 'device kind');
    check(typeof id === 'string' && /^[a-z0-9]{2}-\d{1,3}$/.test(id) && !ids.has(id), 'device id');
    check(id.startsWith(`${DEVICES[kind as EquipmentKind].prefix.toLowerCase()}-`), 'device prefix');
    check(isInt(x, 0, level.size.w - 1) && isInt(y, 0, level.size.h - 1), 'device position');
    check(!taken.has(`${x},${y}`), 'device overlap');
    taken.add(`${x},${y}`);
    ids.add(id);
    design.devices.push({ id, kind: kind as EquipmentKind, x, y });
  }
  const used = new Map<string, number>();
  const cableIds = new Set<string>();
  for (const c of cables) {
    check(isObj(c), 'cable');
    const { id, a, b, kind } = c;
    check(typeof id === 'string' && /^c\d{1,7}$/.test(id) && !cableIds.has(id), 'cable id');
    check(typeof kind === 'string' && CABLE_KINDS.has(kind) && kit.cables.has(kind as CableKind), 'cable kind');
    check(typeof a === 'string' && typeof b === 'string' && a !== b && ids.has(a) && ids.has(b), 'cable ends');
    const na = nodeRef(level, design, a)!;
    const nb = nodeRef(level, design, b)!;
    check(na.kind !== 'laptop' && nb.kind !== 'laptop', 'laptop cable');
    check(isEquipment(na.kind) || isEquipment(nb.kind), 'endpoint to endpoint');
    for (const [x, y] of [
      [na, nb],
      [nb, na],
    ] as const) {
      if (x.kind === 'internet') check(isEquipment(y.kind) && DEVICES[y.kind].nat, 'isp without router');
      if (x.kind === 'ap') check(isEquipment(y.kind), 'access point uplink');
    }
    for (const n of [na, nb]) {
      const count = (used.get(n.id) ?? 0) + 1;
      check(count <= n.ports, 'ports');
      used.set(n.id, count);
    }
    cableIds.add(id);
    design.cables.push({ id, a, b, kind: kind as CableKind });
  }
  check(designCost(level, design) <= level.budget, 'budget');
  return design;
}

function validateConfig(level: LevelDef, raw: unknown, skills: ReadonlySet<SkillId>, start: boolean): NetConfig {
  check(isObj(raw), 'config');
  const groups = new Set(level.groups.map((g) => g.id));
  const pools = new Set(level.endpoints.filter((e) => e.pool).map((e) => e.pool!));
  const users = new Set(level.endpoints.filter((e) => e.kind === 'workstation' || e.kind === 'laptop').map((e) => e.id));

  const vlans: Record<string, number> = {};
  check(isObj(raw.vlans), 'vlans');
  for (const [g, v] of Object.entries(raw.vlans)) {
    check(groups.has(g) && isInt(v, 1, 4094), 'vlan');
    check(hasFeature(level, 'vlan') || v === 1, 'vlan feature');
    vlans[g] = v;
  }

  const subnets: Record<string, string> = {};
  check(isObj(raw.subnets) && Object.keys(raw.subnets).length <= 64, 'subnets');
  for (const [v, c] of Object.entries(raw.subnets)) {
    check(/^\d{1,4}$/.test(v) && isStr(c, 18), 'subnet');
    subnets[v] = c;
  }

  check(Array.isArray(raw.rules) && raw.rules.length <= LIMITS.rules, 'rules');
  check(hasFeature(level, 'firewall') || raw.rules.length === 0, 'firewall feature');
  const rules: FwRule[] = raw.rules.map((r) => {
    check(isObj(r), 'rule');
    const { id, action, src, dst, proto, port } = r;
    check(isInt(id, 0, 1_000_000), 'rule id');
    check(action === 'allow' || action === 'deny', 'rule action');
    check(isStr(src) && isStr(dst), 'rule selectors');
    check(!('error' in parseSelector(src, level)) && !('error' in parseSelector(dst, level)), 'rule selector');
    check(proto === 'any' || proto === 'tcp' || proto === 'udp', 'rule proto');
    check(port === null || isInt(port, 1, 65535), 'rule port');
    return { id, action, src, dst, proto, port };
  });

  const lb: Record<string, LbMode> = {};
  check(isObj(raw.lb), 'lb');
  for (const [p, m] of Object.entries(raw.lb)) {
    check(pools.has(p) && (m === 'none' || m === 'rr' || m === 'least'), 'lb mode');
    check(hasFeature(level, 'lb') || m === 'none', 'lb feature');
    lb[p] = m;
  }

  check(Array.isArray(raw.quarantine) && raw.quarantine.length <= users.size, 'quarantine');
  check(!start || raw.quarantine.length === 0, 'quarantine at start');
  check(hasFeature(level, 'quarantine') || raw.quarantine.length === 0, 'quarantine feature');
  const quarantine = raw.quarantine.map((id) => {
    check(typeof id === 'string' && users.has(id), 'quarantine host');
    return id;
  });

  check(Array.isArray(raw.rateLimits) && raw.rateLimits.length <= LIMITS.rateLimits, 'rate limits');
  check(skills.has('ratelimit') || raw.rateLimits.length === 0, 'rate limit skill');
  const rateLimits: RateLimit[] = raw.rateLimits.map((r) => {
    check(isObj(r), 'rate limit');
    const { id, proto, port, pps } = r;
    check(isInt(id, 0, 1_000_000) && (proto === 'tcp' || proto === 'udp') && isInt(port, 1, 65535), 'rate limit fields');
    check(typeof pps === 'number' && pps > 0 && pps <= 10000, 'rate limit pps');
    return { id, proto, port, pps };
  });

  check(isInt(raw.seq, 1, 1_000_000), 'config seq');
  return { vlans, subnets, rules, lb, quarantine, rateLimits, seq: raw.seq };
}

function validateActions(level: LevelDef, raw: unknown, skills: ReadonlySet<SkillId>): SimAction[] {
  check(Array.isArray(raw) && raw.length <= LIMITS.actions, 'actions');
  const maxTick = Math.ceil(level.dayLength / STEP) + 1;
  let last = 0;
  return raw.map((a) => {
    check(isObj(a) && isInt(a.tick, last, maxTick), 'action tick');
    last = a.tick;
    if (a.kind === 'dispatch') {
      check(isStr(a.id, 16), 'dispatch target');
      return { tick: a.tick, kind: 'dispatch', id: a.id };
    }
    check(a.kind === 'config', 'action kind');
    return { tick: a.tick, kind: 'config', config: validateConfig(level, a.config, skills, false) };
  });
}

/** Checks a record received from elsewhere. Returns the cleaned record, or why it was refused. */
export function validateRun(raw: unknown): RunRecord | string {
  try {
    check(isObj(raw), 'record');
    check(raw.v === SIM_VERSION, 'version');
    check(typeof raw.level === 'string', 'level');
    const level = levelById(raw.level);
    check(level && level.order > 0, 'level');
    const skills = validateSkills(raw.skills);
    const set = new Set(skills);
    const design = validateDesign(level, raw.design, set);
    const config = validateConfig(level, raw.config, set, true);
    const actions = validateActions(level, raw.actions, set);
    return { v: SIM_VERSION, level: level.id, design, config, skills, actions };
  } catch (e) {
    if (e instanceof Invalid) return `invalid ${e.message}`;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Replay

export interface Replay {
  sim: Simulation;
  result: MissionResult;
  score: ScoreBreakdown;
}

/** Plays the whole day again, applying each action at the step where it was recorded. */
export function replayRun(run: RunRecord): Replay {
  const level = levelById(run.level)!;
  const net = buildNetwork(level, run.design);
  const sim = new Simulation(level, net, cloneConfig(run.config), { skills: new Set(run.skills) });
  let i = 0;
  while (!sim.finished) {
    for (; i < run.actions.length && run.actions[i].tick <= sim.ticks; i++) {
      const a = run.actions[i];
      if (a.kind === 'config') sim.applyConfig(cloneConfig(a.config));
      else sim.dispatch(a.id);
    }
    sim.step(STEP);
  }
  const result = evaluate(level, sim, designCost(level, run.design));
  return { sim, result, score: missionScore(level, result) };
}
