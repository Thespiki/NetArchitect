// Objectifs de mission et calcul des étoiles.

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
      return 'Tenir la journée sans que la frustration atteigne 100 %';
    case 'noBreach':
      return 'Aucune brèche : toutes les sondes d’audit doivent être bloquées';
    case 'incidents':
      return 'Réparer chaque panne matérielle dans le délai imparti';
    case 'infected':
      return `Contenir le ver : ${o.max} postes infectés au maximum`;
    case 'service': {
      const name = level.endpoints.find((e) => e.pool === o.pool)?.pool?.toUpperCase() ?? o.pool;
      return `Service ${name} disponible pour au moins ${Math.round(o.min * 100)} % des requêtes`;
    }
  }
}

export function starLabel(s: StarDef): string {
  switch (s.kind) {
    case 'avgFrustration':
      return `Frustration moyenne ≤ ${s.max} %`;
    case 'spent':
      return `Dépenser au plus ${euros(s.max)}`;
    case 'mitigation':
      return `Neutraliser chaque attaque en moins de ${s.max} s`;
    case 'lossRate':
      return `Moins de ${Math.round(s.max * 100)} % de requêtes perdues`;
  }
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
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
          detail: sim.failed ? `Abandon à ${sim.clock}` : `Pic à ${Math.round(st.peakFrustration)} %`,
        };
      case 'noBreach':
        return {
          label,
          ok: st.breaches === 0,
          detail: `${st.breaches} brèche(s), ${st.probesBlocked}/${st.probes} sondes bloquées`,
        };
      case 'incidents': {
        const fails = sim.incidents.filter((i) => i.kind === 'failure');
        const ok = fails.every((i) => i.resolved !== undefined && !i.missed);
        const done = fails.filter((i) => i.resolved !== undefined && !i.missed).length;
        return { label, ok, detail: fails.length ? `${done}/${fails.length} dans les délais` : 'Aucune panne' };
      }
      case 'infected':
        return { label, ok: st.infectedTotal <= o.max, detail: `${st.infectedTotal} poste(s) infecté(s)` };
      case 'service': {
        const total = st.poolTotal[o.pool] ?? 0;
        const rate = total ? (st.poolOk[o.pool] ?? 0) / total : 0;
        return { label, ok: total > 0 && rate >= o.min, detail: `${pct(rate)} de ${total} requêtes` };
      }
    }
  });

  const ddos = sim.incidents.filter((i) => i.kind === 'ddos');
  const starRules: ObjectiveResult[] = level.stars.map((s) => {
    const label = starLabel(s);
    switch (s.kind) {
      case 'avgFrustration':
        return { label, ok: sim.averageFrustration <= s.max, detail: `${Math.round(sim.averageFrustration)} %` };
      case 'spent':
        return { label, ok: spent <= s.max, detail: euros(spent) };
      case 'mitigation': {
        const times = ddos.map((i) => (i.resolved !== undefined ? i.resolved - i.start : Infinity));
        const worst = times.length ? Math.max(...times) : 0;
        return {
          label,
          ok: worst <= s.max,
          detail: !times.length ? 'Aucune attaque' : worst === Infinity ? 'Attaque non neutralisée' : `${Math.round(worst)} s`,
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
    failReason: sim.failed ? sim.failReason : failed ? `Objectif manqué : ${failed.label.toLowerCase()}.` : '',
    spent,
    avgFrustration: sim.averageFrustration,
    peakFrustration: st.peakFrustration,
    lossRate,
    transactions: st.transactions,
  };
}
