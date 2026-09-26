// Solutions de référence : prouvent que chaque mission se gagne avec le matériel de base
// (aucune compétence), et servent de banc d'essai pour l'équilibrage.

import { defaultConfig, type NetConfig } from '../src/core/config.ts';
import { execute } from '../src/core/console.ts';
import { autoCable, connect, emptyDesign, placeDevice, type Design } from '../src/core/design.ts';
import { consoleHost, type ScriptStep } from '../src/core/headless.ts';
import type { LevelDef } from '../src/core/level.ts';
import { buildNetwork } from '../src/core/network.ts';
import type { CableKind, EquipmentKind, SkillId } from '../src/core/types.ts';

export interface Solution {
  devices: [EquipmentKind, number, number][];
  cables: [string, string, CableKind?][];
  auto?: string[];
  configure?: string[];
  script?: ScriptStep[];
  skills?: SkillId[];
}

/** Déclenche une commande `delay` secondes après le début d'un événement du niveau. */
function after(level: LevelDef, kind: string, delay: number, cmd: string): ScriptStep {
  const ev = level.events!.find((e) => e.kind === kind)!;
  return { at: ev.at * level.dayLength + delay, cmd };
}

export const SOLUTIONS: Record<string, (level: LevelDef) => Solution> = {
  pixelbrew: () => ({
    devices: [
      ['router', 17, 3],
      ['switch8', 6, 5],
    ],
    cables: [
      ['fai', 'rt-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'nas'],
    ],
    auto: ['sw-1'],
  }),

  kiwi: () => ({
    devices: [
      ['router', 22, 4],
      ['switch24', 14, 9],
      ['ap', 15, 13],
    ],
    cables: [
      ['fai', 'rt-1'],
      ['fai', 'rt-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-1'],
      ['sw-1', 'nas'],
      ['sw-1', 'nas'],
      ['sw-1', 'ap-1'],
    ],
    auto: ['sw-1'],
  }),

  bionova: () => ({
    devices: [
      ['router', 23, 5],
      ['switch24', 11, 10],
      ['switch8', 26, 4],
    ],
    cables: [
      ['fai', 'rt-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-2'],
      ['sw-2', 'labdata'],
      ['sw-2', 'erp'],
      ['sw-2', 'intranet'],
    ],
    auto: ['sw-1'],
    configure: [
      'vlan rnd 20',
      'vlan compta 10',
      'vlan srv 99',
      'subnet 20 10.42.0.0/28',
      'subnet 10 10.42.0.16/29',
      'subnet 99 10.42.0.24/29',
      'fw deny compta labdata',
      'fw deny rnd erp',
    ],
  }),

  shopnow: (level) => ({
    devices: [
      ['router_pro', 18, 6],
      ['switch24', 23, 5],
      ['switch24', 7, 9],
    ],
    cables: [
      ['fai', 'rt-1', 'fiber'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-2'],
      ['sw-1', 'web-1'],
      ['sw-1', 'web-2'],
      ['sw-1', 'web-3'],
    ],
    auto: ['sw-2'],
    configure: ['lb web rr'],
    script: [after(level, 'ddos', 8, 'block udp 123')],
  }),

  helios: (level) => ({
    devices: [
      ['router_pro', 29, 5],
      ['switch24', 32, 5],
      ['switch24', 27, 11],
      ['switch24', 13, 5],
      ['switch24', 13, 16],
      ['ap', 21, 5],
    ],
    cables: [
      ['fai', 'rt-1'],
      ['fai', 'rt-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-1'],
      ['rt-1', 'sw-2'],
      ['rt-1', 'sw-2'],
      ['sw-2', 'sw-3'],
      ['sw-2', 'sw-4'],
      ['sw-3', 'ap-1'],
      ['sw-1', 'files'],
      ['sw-1', 'git'],
      ['sw-1', 'portal-1'],
      ['sw-1', 'portal-2'],
    ],
    auto: ['sw-3', 'sw-4', 'sw-2'],
    configure: [
      'vlan mkt 10',
      'vlan dev 20',
      'vlan fin 30',
      'vlan srv 99',
      'fw deny mkt fin',
      'fw deny vlan10 vlan20 tcp/445',
      'lb portal rr',
    ],
    script: [
      {
        at: level.events!.find((e) => e.kind === 'failure')!.at * level.dayLength + 2,
        run: (sim, exec) => {
          const inc = sim.incidents.find((i) => i.kind === 'failure');
          if (inc?.target) exec(`dispatch ${inc.target}`);
        },
      },
      {
        at: level.events!.find((e) => e.kind === 'worm')!.at * level.dayLength + 7,
        every: 3,
        run: (sim, exec) => {
          for (const s of sim.activeInfected()) exec(`quarantine ${s.node.id}`);
          for (const s of sim.states.values()) {
            if (s.quarantined && s.infected) exec(`dispatch ${s.node.id}`);
          }
        },
      },
      after(level, 'ddos', 8, 'blockip 185.220.0.0/16'),
    ],
  }),
};

export function buildSolution(
  level: LevelDef,
  sol: Solution,
  skills: ReadonlySet<SkillId> = new Set(),
): { design: Design; config: NetConfig; errors: string[] } {
  const design = emptyDesign();
  const errors: string[] = [];
  for (const [kind, x, y] of sol.devices) {
    const r = placeDevice(level, design, kind, x, y, skills);
    if (typeof r === 'string') errors.push(`${kind} (${x},${y}) : ${r}`);
  }
  for (const [a, b, kind] of sol.cables) {
    const r = connect(level, design, a, b, kind ?? 'rj45', skills);
    if (typeof r === 'string') errors.push(`${a}–${b} : ${r}`);
  }
  for (const hub of sol.auto ?? []) autoCable(level, design, hub, skills);
  let config = defaultConfig(level);
  const net = buildNetwork(level, design);
  const host = consoleHost(
    level,
    net,
    design,
    () => config,
    (c) => (config = c),
    () => null,
    skills,
  );
  for (const cmd of sol.configure ?? []) {
    for (const line of execute(cmd, host)) if (line.tone === 'err') errors.push(`${cmd} : ${line.text}`);
  }
  return { design, config, errors };
}
