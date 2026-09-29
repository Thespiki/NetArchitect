// Skill tree: points earned with mission stars. Names follow the current language.

import { T } from '../i18n/index.ts';
import type { SkillId } from './types.ts';

export type Branch = 'infra' | 'secu' | 'ops';

export interface SkillDef {
  id: SkillId;
  readonly name: string;
  branch: Branch;
  tier: number;
  cost: number;
  requires: SkillId[];
  readonly desc: string;
}

export interface BranchDef {
  id: Branch;
  readonly name: string;
  readonly blurb: string;
}

function branch(id: Branch): BranchDef {
  return {
    id,
    get name() {
      return T.skills.branches[id].name;
    },
    get blurb() {
      return T.skills.branches[id].blurb;
    },
  };
}

function skill(d: Omit<SkillDef, 'name' | 'desc'>): SkillDef {
  return {
    ...d,
    get name() {
      return T.skills.list[d.id].name;
    },
    get desc() {
      return T.skills.list[d.id].desc;
    },
  };
}

export const BRANCHES: BranchDef[] = [branch('infra'), branch('secu'), branch('ops')];

export const SKILLS: SkillDef[] = [
  skill({
    id: 'fiber',
    branch: 'infra',
    tier: 0,
    cost: 1,
    requires: [],
  }),
  skill({
    id: 'cooling',
    branch: 'infra',
    tier: 0,
    cost: 1,
    requires: [],
  }),
  skill({
    id: 'switch_l3',
    branch: 'infra',
    tier: 1,
    cost: 2,
    requires: ['fiber'],
  }),
  skill({
    id: 'router_pro',
    branch: 'infra',
    tier: 2,
    cost: 2,
    requires: ['switch_l3'],
  }),
  skill({
    id: 'ids',
    branch: 'secu',
    tier: 0,
    cost: 1,
    requires: [],
  }),
  skill({
    id: 'ratelimit',
    branch: 'secu',
    tier: 1,
    cost: 1,
    requires: ['ids'],
  }),
  skill({
    id: 'autoblock',
    branch: 'secu',
    tier: 2,
    cost: 2,
    requires: ['ids'],
  }),
  skill({
    id: 'snmp',
    branch: 'ops',
    tier: 0,
    cost: 1,
    requires: [],
  }),
  skill({
    id: 'tech_speed',
    branch: 'ops',
    tier: 0,
    cost: 1,
    requires: [],
  }),
  skill({
    id: 'autovlan',
    branch: 'ops',
    tier: 1,
    cost: 2,
    requires: ['snmp'],
  }),
  skill({
    id: 'lb_least',
    branch: 'ops',
    tier: 1,
    cost: 1,
    requires: ['snmp'],
  }),
  skill({
    id: 'tech2',
    branch: 'ops',
    tier: 2,
    cost: 2,
    requires: ['tech_speed'],
  }),
];

export function skillById(id: SkillId): SkillDef {
  return SKILLS.find((s) => s.id === id)!;
}

export function canBuy(id: SkillId, owned: ReadonlySet<SkillId>, points: number): boolean {
  const s = skillById(id);
  return !owned.has(id) && points >= s.cost && s.requires.every((r) => owned.has(r));
}

export function spentPoints(owned: Iterable<SkillId>): number {
  let n = 0;
  for (const id of owned) n += skillById(id).cost;
  return n;
}
