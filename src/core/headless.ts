// Runs a full day without rendering: tests, balancing and demos.

import { cloneConfig, type NetConfig } from './config.ts';
import { execute, type ConsoleHost, type Line } from './console.ts';
import { preflight } from './diagnostics.ts';
import { designCost, type Design } from './design.ts';
import type { LevelDef } from './level.ts';
import { buildNetwork, type Network } from './network.ts';
import { evaluate, type MissionResult } from './objectives.ts';
import { Simulation, STEP } from './simulation.ts';
import type { SkillId } from './types.ts';

export interface ScriptStep {
  /** Time in simulation seconds. */
  at: number;
  cmd?: string;
  run?: (sim: Simulation, exec: (cmd: string) => Line[]) => void;
  /** Repeats the step every `every` seconds until the end of the day. */
  every?: number;
}

export interface PlayOptions {
  skills?: ReadonlySet<SkillId>;
  seed?: number;
  script?: ScriptStep[];
  log?: (line: string) => void;
}

export function consoleHost(
  level: LevelDef,
  net: Network,
  design: Design,
  getConfig: () => NetConfig,
  setConfig: (c: NetConfig) => void,
  sim: () => Simulation | null,
  skills: ReadonlySet<SkillId>,
): ConsoleHost {
  return {
    level,
    skills,
    phase: () => (sim() ? 'live' : 'config'),
    network: () => net,
    config: getConfig,
    setConfig,
    sim,
    issues: () => preflight(level, design, net, getConfig()),
  };
}

export function playDay(
  level: LevelDef,
  design: Design,
  config: NetConfig,
  opts: PlayOptions = {},
): { sim: Simulation; result: MissionResult; spent: number } {
  const skills = opts.skills ?? new Set<SkillId>();
  const net = buildNetwork(level, design);
  let cfg = cloneConfig(config);
  const sim = new Simulation(level, net, cfg, { skills, seed: opts.seed });
  const host = consoleHost(
    level,
    net,
    design,
    () => sim.config,
    (c) => {
      cfg = c;
      sim.applyConfig(c);
    },
    () => sim,
    skills,
  );
  const exec = (cmd: string) => {
    const lines = execute(cmd, host);
    opts.log?.(`[${sim.clock}] > ${cmd}\n${lines.map((l) => `    ${l.text}`).join('\n')}`);
    return lines;
  };
  const pending = (opts.script ?? []).map((s) => ({ ...s, next: s.at }));
  while (!sim.finished) {
    sim.step(STEP);
    for (const s of pending) {
      if (s.next === Infinity || sim.t < s.next) continue;
      if (s.cmd) exec(s.cmd);
      s.run?.(sim, exec);
      s.next = s.every ? s.next + s.every : Infinity;
    }
  }
  const spent = designCost(level, design);
  return { sim, result: evaluate(level, sim, spent), spent };
}
