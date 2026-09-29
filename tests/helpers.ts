// Small test level: two groups, a server, the Internet and a large budget.

import { same } from '../src/i18n/index.ts';
import type { LevelDef } from '../src/core/level.ts';

export function miniLevel(overrides: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'mini',
    order: 99,
    company: 'Test SA',
    title: same('Test bench'),
    tagline: same(''),
    brief: [],
    newMechanics: [],
    size: { w: 30, h: 12 },
    rooms: [
      { id: 'a', name: same('Office A'), kind: 'office', x: 1, y: 1, w: 8, h: 10 },
      { id: 'b', name: same('Office B'), kind: 'office', x: 10, y: 1, w: 8, h: 10 },
      { id: 'srv', name: same('Server room'), kind: 'server', x: 20, y: 1, w: 8, h: 10 },
    ],
    groups: [
      { id: 'ga', name: same('Group A'), color: '#fff' },
      { id: 'gb', name: same('Group B'), color: '#fff' },
      { id: 'srv', name: same('Servers'), color: '#fff' },
    ],
    endpoints: [
      { id: 'net', kind: 'internet', x: 29, y: 5, label: same('ISP') },
      { id: 'a1', kind: 'workstation', x: 2, y: 2, group: 'ga' },
      { id: 'a2', kind: 'workstation', x: 4, y: 2, group: 'ga' },
      { id: 'b1', kind: 'workstation', x: 12, y: 2, group: 'gb' },
      { id: 'lap', kind: 'laptop', x: 14, y: 8, group: 'gb' },
      { id: 'db', kind: 'server', x: 22, y: 3, group: 'srv', pool: 'db', capacity: 20, port: 5432 },
    ],
    techBase: { x: 25, y: 9 },
    budget: 100000,
    dayLength: 60,
    features: ['vlan', 'subnets', 'firewall', 'lb', 'quarantine'],
    equipment: ['switch8', 'switch24', 'router', 'ap', 'switch_l3', 'router_pro'],
    cables: ['rj45', 'fiber'],
    addressing: { mode: 'auto' },
    traffic: {
      groups: {
        ga: { rate: 1, mix: { web: 0.5, data: 0.5 }, data: ['db'] },
        gb: { rate: 1, mix: { web: 1 } },
      },
      curve: 'office',
    },
    objectives: [{ kind: 'survive' }],
    stars: [],
    tips: [],
    seed: 42,
    ...overrides,
  };
}
