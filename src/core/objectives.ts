// Mission objectives and star rating.

import { pct, T } from '../i18n/index.ts';
import { euros } from './catalog.ts';
import type { LevelDef, ObjectiveDef, StarDef } from './level.ts';
import type { Simulation } from './simulation.ts';

export interface ObjectiveResult {
  label: string;
  ok: boolean;
  detail: string;
}

export interface MissionResult {
  success: boolean;
  stars: number;
  objectives: ObjectiveResult[];
  starRules: ObjectiveResult[];
  failReason: string;
  spent: number;
  avgFrustration: number;
  peakFrustration: number;
  lossRate: number;
  transactions: number;
}

export function objectiveLabel(o: ObjectiveDef, level: LevelDef): string {
  switch (o.kind) {
    case 'survive':
      return T.objectives.survive;
    case 'noBreach':
      return T.objectives.noBreach;
    case 'incidents':
      return T.objectives.incidents;
    case 'infected':
      return T.objectives.infected(o.max);
    case 'service': {
      const name = level.endpoints.find((e) => e.pool === o.pool)?.pool?.toUpperCase() ?? o.pool;
      return T.objectives.service(name, o.min);
    }
  }
}

export function starLabel(s: StarDef): string {
  switch (s.kind) {
    case 'avgFrustration':
      return T.objectives.starFrustration(s.max);
    case 'spent':
      return T.objectives.starSpent(s.max);
    case 'mitigation':
      return T.objectives.starMitigation(s.max);
    case 'lossRate':
      return T.objectives.starLoss(s.max);
  }
}

export function evaluate(level: LevelDef, sim: Simulation, spent: number): MissionResult {
  const st = sim.stats;
  const lossRate = st.transactions ? st.failed / st.transactions : 0;
  const objectives: ObjectiveResult[] = level.objectives.map((o) => {
    const label = objectiveLabel(o, level);
    switch (o.kind) {
      case 'survive':
        return {
          label,
          ok: !sim.failed,
          detail: sim.failed ? T.objectives.gaveUp(sim.clock) : T.objectives.peak(st.peakFrustration),
        };
      case 'noBreach':
        return {
          label,
          ok: st.breaches === 0,
          detail: T.objectives.breaches(st.breaches, st.probesBlocked, st.probes),
        };
      case 'incidents': {
        const fails = sim.incidents.filter((i) => i.kind === 'failure');
        const ok = fails.every((i) => i.resolved !== undefined && !i.missed);
        const done = fails.filter((i) => i.resolved !== undefined && !i.missed).length;
        return { label, ok, detail: fails.length ? T.objectives.onTime(done, fails.length) : T.objectives.noFailure };
      }
      case 'infected':
        return { label, ok: st.infectedTotal <= o.max, detail: T.objectives.infectedCount(st.infectedTotal) };
      case 'service': {
        const total = st.poolTotal[o.pool] ?? 0;
        const rate = total ? (st.poolOk[o.pool] ?? 0) / total : 0;
        return { label, ok: total > 0 && rate >= o.min, detail: T.objectives.ofRequests(pct(rate), total) };
      }
    }
  });

  const ddos = sim.incidents.filter((i) => i.kind === 'ddos');
  const starRules: ObjectiveResult[] = level.stars.map((s) => {
    const label = starLabel(s);
    switch (s.kind) {
      case 'avgFrustration':
        return { label, ok: sim.averageFrustration <= s.max, detail: pct(sim.averageFrustration / 100) };
      case 'spent':
        return { label, ok: spent <= s.max, detail: euros(spent) };
      case 'mitigation': {
        const times = ddos.map((i) => (i.resolved !== undefined ? i.resolved - i.start : Infinity));
        const worst = times.length ? Math.max(...times) : 0;
        return {
          label,
          ok: worst <= s.max,
          detail: !times.length ? T.objectives.noAttack : worst === Infinity ? T.objectives.notStopped : `${Math.round(worst)} s`,
        };
      }
      case 'lossRate':
        return { label, ok: lossRate <= s.max, detail: pct(lossRate) };
    }
  });

  const success = !sim.failed && objectives.every((o) => o.ok);
  const stars = success ? 1 + starRules.filter((s) => s.ok).length : 0;
  const failed = objectives.find((o) => !o.ok);
  return {
    success,
    stars,
    objectives,
    starRules,
    failReason: sim.failed ? sim.failReason : failed ? T.objectives.missed(failed.label) : '',
    spent,
    avgFrustration: sim.averageFrustration,
    peakFrustration: st.peakFrustration,
    lossRate,
    transactions: st.transactions,
  };
}
