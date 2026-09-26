// Banc d'équilibrage : joue chaque mission avec sa solution de référence (et des variantes
// dégradées) et affiche charge, chaleur et frustration. Usage : npm run balance [-- missionId]

import { tempCelsius } from '../src/core/catalog.ts';
import { defaultConfig } from '../src/core/config.ts';
import { emptyDesign } from '../src/core/design.ts';
import { playDay, type ScriptStep } from '../src/core/headless.ts';
import { LEVELS } from '../src/core/levels.ts';
import type { Simulation } from '../src/core/simulation.ts';
import { buildSolution, SOLUTIONS, type Solution } from '../tests/solutions.ts';

const only = process.argv[2];

function sampler(peaks: Map<string, { load: number; heat: number }>, links: Map<string, number>): ScriptStep {
  return {
    at: 1,
    every: 0.5,
    run: (sim: Simulation) => {
      for (const s of sim.states.values()) {
        if (!s.node.transit && s.node.kind !== 'server') continue;
        const p = peaks.get(s.node.label) ?? { load: 0, heat: 0 };
        p.load = Math.max(p.load, s.load);
        p.heat = Math.max(p.heat, s.heat);
        peaks.set(s.node.label, p);
      }
      for (const l of sim.net.links) {
        const key = `${sim.net.byId.get(l.a)!.label}↔${sim.net.byId.get(l.b)!.label}#${l.id}`;
        links.set(key, Math.max(links.get(key) ?? 0, sim.linkUtil(l.id)));
      }
    },
  };
}

function run(label: string, levelId: string, mutate?: (s: Solution) => Solution, verbose = false): void {
  const level = LEVELS.find((l) => l.id === levelId)!;
  let sol = SOLUTIONS[levelId](level);
  if (mutate) sol = mutate(sol);
  const built = buildSolution(level, sol);
  if (built.errors.length) console.log(`  ⚠ erreurs de construction :\n    ${built.errors.join('\n    ')}`);
  const peaks = new Map<string, { load: number; heat: number }>();
  const links = new Map<string, number>();
  const t0 = performance.now();
  const { sim, result, spent } = playDay(level, built.design, built.config, {
    script: [...(sol.script ?? []), sampler(peaks, links)],
    log: verbose ? (l) => console.log(`    ${l.replace(/\n/g, '\n    ')}`) : undefined,
  });
  const ms = Math.round(performance.now() - t0);
  const st = sim.stats;
  const verdict = result.success ? `RÉUSSIE ${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}` : 'ÉCHEC';
  console.log(`  ${label.padEnd(34)} ${verdict.padEnd(14)} F moy ${result.avgFrustration.toFixed(1).padStart(5)} %  pic ${result.peakFrustration.toFixed(0).padStart(3)} %  pertes ${(result.lossRate * 100).toFixed(1).padStart(5)} %  ${spent} €  (${ms} ms)`);
  if (!result.success) console.log(`      → ${result.failReason}`);
  console.log(
    `      transactions ${st.transactions}  ok ${st.good}  lentes ${st.late}  échecs ${st.failed}  | drops ${JSON.stringify(st.drops)}  inj ${st.unreachable}`,
  );
  if (st.probes) console.log(`      sondes ${st.probes}  bloquées ${st.probesBlocked}  brèches ${st.breaches}`);
  if (st.attackPackets) console.log(`      attaque ${st.attackPackets} paquets, ${st.attackBlocked} bloqués`);
  if (st.infectedTotal) console.log(`      infectés ${st.infectedTotal}`);
  for (const inc of sim.incidents) {
    console.log(
      `      incident ${inc.label} : début ${inc.start.toFixed(0)} s, ${inc.resolved !== undefined ? `résolu en ${(inc.resolved - inc.start).toFixed(1)} s` : 'non résolu'}${inc.missed ? ' (délai manqué)' : ''}`,
    );
  }
  for (const o of [...result.objectives, ...result.starRules]) console.log(`      ${o.ok ? '✔' : '✖'} ${o.label} — ${o.detail}`);
  if (verbose || process.env.DETAIL) {
    const top = [...peaks.entries()].sort((a, b) => b[1].load - a[1].load).slice(0, 8);
    console.log(`      charges max : ${top.map(([k, v]) => `${k} ${Math.round(v.load * 100)} %/${tempCelsius(v.heat)}°C`).join(' · ')}`);
    const hot = [...links.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`      liens max : ${hot.map(([k, v]) => `${k.split('#')[0]} ${Math.round(v * 100)} %`).join(' · ')}`);
  }
}

for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  console.log(`\n=== ${level.order}. ${level.company} — ${level.title} (${level.dayLength} s, budget ${level.budget} €)`);
  run('solution de référence', level.id, undefined, !!process.env.VERBOSE);
  const empty = playDay(level, emptyDesign(), defaultConfig(level));
  console.log(`  ${'conception vide'.padEnd(34)} ${empty.result.success ? 'RÉUSSIE ?!' : 'ÉCHEC'} (abandon à ${empty.sim.clock})`);
  if (level.id === 'shopnow') {
    run('sans répartition de charge', level.id, (s) => ({ ...s, configure: [] }));
    run('sans blocage du DDoS', level.id, (s) => ({ ...s, script: [] }));
  }
  if (level.id === 'bionova') {
    run('sans règles de pare-feu', level.id, (s) => ({ ...s, configure: s.configure!.filter((c) => !c.startsWith('fw')) }));
    run('réseau à plat + règles', level.id, (s) => ({
      ...s,
      configure: ['subnet 1 10.42.0.0/27', ...s.configure!.filter((c) => c.startsWith('fw'))],
    }));
    run('un seul lien trunk', level.id, (s) => {
      const cables = [...s.cables];
      cables.splice(cables.findIndex((c) => c[0] === 'rt-1' && c[1] === 'sw-1'), 1);
      return { ...s, cables };
    });
  }
  if (level.id === 'pixelbrew') {
    run('routeur dans l’open space', level.id, (s) => ({ ...s, devices: [['router', 12, 5], s.devices[1]] }));
  }
  if (level.id === 'helios') {
    run('sans aucune réaction', level.id, (s) => ({ ...s, script: [] }));
    // Joueur humain : réagit avec retard et traite les postes infectés par vagues.
    const worm = level.events!.find((e) => e.kind === 'worm')!.at * level.dayLength;
    run('réaction humaine lente au ver', level.id, (s) => ({
      ...s,
      script: [
        s.script![0],
        s.script![2],
        {
          at: worm + 12,
          every: 7,
          run: (sim, exec) => {
            for (const st of sim.activeInfected()) exec(`quarantine ${st.node.id}`);
            for (const st of sim.states.values()) if (st.quarantined && st.infected) exec(`dispatch ${st.node.id}`);
          },
        },
      ],
    }));
    run('ver ignoré, reste géré', level.id, (s) => ({ ...s, script: [s.script![0], s.script![2]] }));
  }
  if (level.id === 'kiwi') {
    run('un seul câble vers le NAS', level.id, (s) => {
      const cables = [...s.cables];
      cables.splice(cables.findIndex((c) => c[1] === 'nas'), 1);
      return { ...s, cables };
    });
  }
}
