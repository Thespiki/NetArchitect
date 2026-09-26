import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.ts';
import { connect, emptyDesign, placeDevice } from '../src/core/design.ts';
import { playDay } from '../src/core/headless.ts';
import { LEVELS, levelById } from '../src/core/levels.ts';
import { buildNetwork } from '../src/core/network.ts';
import { Simulation } from '../src/core/simulation.ts';
import type { SkillId } from '../src/core/types.ts';
import { miniLevel } from './helpers.ts';
import { buildSolution, SOLUTIONS } from './solutions.ts';

const none = new Set<SkillId>();

describe('campagne', () => {
  for (const level of LEVELS) {
    it(`${level.order}. ${level.company} se gagne avec la solution de référence, sans compétence`, () => {
      const sol = SOLUTIONS[level.id](level);
      const built = buildSolution(level, sol);
      expect(built.errors).toEqual([]);
      const { result } = playDay(level, built.design, built.config, { script: sol.script });
      expect(result.failReason).toBe('');
      expect(result.success).toBe(true);
      expect(result.stars).toBeGreaterThanOrEqual(2);
    });

    it(`${level.order}. ${level.company} est perdue avec une conception vide`, () => {
      const { result, sim } = playDay(level, emptyDesign(), defaultConfig(level));
      expect(result.success).toBe(false);
      expect(sim.failed).toBe(true);
    });
  }
});

describe('simulation', () => {
  it('est déterministe à graine égale', () => {
    const level = levelById('kiwi')!;
    const built = buildSolution(level, SOLUTIONS.kiwi(level));
    const a = playDay(level, built.design, built.config).sim.stats;
    const b = playDay(level, built.design, built.config).sim.stats;
    expect(a).toEqual(b);
  });

  it('un réseau à plat laisse passer les sondes malgré le pare-feu', () => {
    const level = levelById('bionova')!;
    const sol = SOLUTIONS.bionova(level);
    const flat = { ...sol, configure: ['subnet 1 10.42.0.0/27', 'fw deny compta labdata', 'fw deny rnd erp'] };
    const built = buildSolution(level, flat);
    const { result, sim } = playDay(level, built.design, built.config);
    expect(sim.stats.breaches).toBeGreaterThan(0);
    expect(result.success).toBe(false);
  });

  it('sans répartition de charge, le Black Friday submerge le premier serveur', () => {
    const level = levelById('shopnow')!;
    const sol = SOLUTIONS.shopnow(level);
    const built = buildSolution(level, { ...sol, configure: [] });
    const { result } = playDay(level, built.design, built.config, { script: sol.script });
    expect(result.success).toBe(false);
  });

  it('bloquer le port de l’attaque neutralise le DDoS', () => {
    const level = levelById('shopnow')!;
    const sol = SOLUTIONS.shopnow(level);
    const built = buildSolution(level, sol);
    const { sim } = playDay(level, built.design, built.config, { script: sol.script });
    const ddos = sim.incidents.find((i) => i.kind === 'ddos')!;
    expect(ddos.resolved).toBeDefined();
    expect(ddos.resolved! - ddos.start).toBeLessThan(20);
    expect(sim.stats.attackBlocked).toBeGreaterThan(sim.stats.attackPackets * 0.8);
  });

  it('le script d’auto-mitigation pose la règle tout seul', () => {
    const level = levelById('shopnow')!;
    const sol = SOLUTIONS.shopnow(level);
    const built = buildSolution(level, sol);
    const skills = new Set<SkillId>(['ids', 'autoblock']);
    const { sim, result } = playDay(level, built.design, built.config, { skills });
    expect(sim.config.rules.some((r) => r.port === 123 && r.action === 'deny')).toBe(true);
    expect(result.success).toBe(true);
  });

  it('un switch en panne se répare seulement avec un technicien', () => {
    const level = levelById('helios')!;
    const built = buildSolution(level, SOLUTIONS.helios(level));
    const sim = new Simulation(level, buildNetwork(level, built.design), built.config);
    while (!sim.incidents.some((i) => i.kind === 'failure')) sim.step();
    const inc = sim.incidents.find((i) => i.kind === 'failure')!;
    const target = sim.states.get(inc.target!)!;
    expect(target.up).toBe(false);
    for (let i = 0; i < 600; i++) sim.step();
    expect(target.up).toBe(false);
    expect(sim.dispatch(inc.target!).ok).toBe(true);
    expect(sim.dispatch(inc.target!).ok).toBe(false);
    for (let i = 0; i < 60 * 30 && inc.resolved === undefined; i++) sim.step();
    expect(target.up).toBe(true);
    expect(inc.resolved).toBeDefined();
  });

  it('un équipement saturé surchauffe dans un bureau, pas en salle serveurs', () => {
    const run = (x: number, y: number) => {
      const level = miniLevel({
        traffic: { groups: { ga: { rate: 25, mix: { web: 1 } } }, curve: 'office' },
      });
      const d = emptyDesign();
      placeDevice(level, d, 'router', 26, 5, none);
      placeDevice(level, d, 'switch8', x, y, none);
      connect(level, d, 'net', 'rt-1', 'fiber', none);
      connect(level, d, 'rt-1', 'sw-1', 'fiber', none);
      connect(level, d, 'rt-1', 'sw-1', 'fiber', none);
      connect(level, d, 'sw-1', 'a1', 'fiber', none);
      connect(level, d, 'sw-1', 'a2', 'fiber', none);
      const sim = new Simulation(level, buildNetwork(level, d), defaultConfig(level));
      for (let i = 0; i < 60 * 45; i++) sim.step();
      return sim;
    };
    const office = run(6, 6);
    expect(office.stats.overheats).toBeGreaterThan(0);
    const cooled = run(22, 6);
    expect(cooled.stats.overheats).toBe(0);
    expect(cooled.states.get('sw-1')!.load).toBeGreaterThan(0.9);
  });
});
