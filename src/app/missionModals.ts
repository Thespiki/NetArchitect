// Briefing avant mission et débriefing de fin de journée.

import { euros } from '../core/catalog.ts';
import type { LevelDef } from '../core/level.ts';
import { objectiveLabel, starLabel, type MissionResult } from '../core/objectives.ts';
import type { Simulation } from '../core/simulation.ts';
import { FONT_MONO, hexAlpha, PAL } from '../render/glyphs.ts';
import { h, stars } from './dom.ts';
import { openModal, type ModalAction } from './modal.ts';

export function showBriefing(host: HTMLElement, level: LevelDef, restored: boolean, onStart: () => void, onBack: () => void): void {
  const users = level.endpoints.filter((e) => e.kind === 'workstation' || e.kind === 'laptop').length;
  const servers = level.endpoints.filter((e) => e.kind === 'server').length;
  openModal(host, {
    eyebrow: `Mission ${String(level.order).padStart(2, '0')} · ${level.rank}`,
    title: `${level.company} — ${level.title}`,
    wide: true,
    dismissible: false,
    className: 'briefing',
    body: [
      ...level.brief.map((p) => h('p', { class: 'brief' }, p)),
      h(
        'dl',
        { class: 'facts' },
        h('div', null, h('dt', null, 'Budget'), h('dd', null, euros(level.budget))),
        h('div', null, h('dt', null, 'Utilisateurs'), h('dd', null, String(users))),
        h('div', null, h('dt', null, 'Serveurs'), h('dd', null, String(servers))),
        h('div', null, h('dt', null, 'Journée'), h('dd', null, `9 h → 18 h en ${Math.round(level.dayLength)} s`)),
      ),
      level.newMechanics.length
        ? h(
            'div',
            { class: 'mechanics' },
            ...level.newMechanics.map((m) => h('article', null, h('h4', null, m.title), h('p', null, m.text))),
          )
        : null,
      h(
        'div',
        { class: 'brief-goals' },
        h('div', null, h('h4', null, 'Objectifs'), h('ul', null, ...level.objectives.map((o) => h('li', null, objectiveLabel(o, level))))),
        h('div', null, h('h4', null, 'Étoiles bonus'), h('ul', null, ...level.stars.map((s) => h('li', null, `★ ${starLabel(s)}`)))),
      ),
      restored ? h('p', { class: 'muted' }, 'Ton dernier plan pour cette mission a été restauré.') : null,
    ],
    actions: [
      { label: 'Retour à la carrière', onClick: onBack },
      { label: 'Commencer', kind: 'primary', onClick: onStart },
    ],
  });
}

function sparkline(history: number[], dayLength: number): HTMLElement {
  const W = 400;
  const H = 128;
  const c = h('canvas', { class: 'spark', width: String(W * 2), height: String(H * 2), role: 'img' });
  c.setAttribute('aria-label', `Frustration au fil de la journée, maximum ${Math.round(Math.max(0, ...history))} %`);
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(2, 2);
  const padL = 30;
  const padB = 26;
  const plotW = W - padL - 8;
  const plotH = H - padB - 8;
  const x = (i: number) => padL + (i / Math.max(1, dayLength)) * plotW;
  const y = (v: number) => 8 + plotH - (v / 100) * plotH;
  g.font = `10px ${FONT_MONO}`;
  g.fillStyle = PAL.dim;
  g.strokeStyle = 'rgba(130, 160, 215, 0.14)';
  g.lineWidth = 1;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const v of [0, 50, 100]) {
    g.beginPath();
    g.moveTo(padL, y(v));
    g.lineTo(W - 8, y(v));
    g.stroke();
    g.fillText(`${v}`, padL - 6, y(v));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const ticks: [number, string, CanvasTextAlign][] = [
    [0, '9 h', 'left'],
    [0.5, '13 h 30', 'center'],
    [1, '18 h', 'right'],
  ];
  for (const [f, label, align] of ticks) {
    g.textAlign = align;
    g.fillText(label, padL + f * plotW, H - padB + 6);
  }
  if (history.length > 1) {
    const grad = g.createLinearGradient(0, y(100), 0, y(0));
    grad.addColorStop(0, hexAlpha(PAL.crit, 0.45));
    grad.addColorStop(0.6, hexAlpha(PAL.warn, 0.2));
    grad.addColorStop(1, hexAlpha(PAL.ok, 0.05));
    g.beginPath();
    g.moveTo(x(0), y(0));
    history.forEach((v, i) => g.lineTo(x(i), y(v)));
    g.lineTo(x(history.length - 1), y(0));
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.beginPath();
    history.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.strokeStyle = PAL.warn;
    g.lineWidth = 1.6;
    g.stroke();
    const last = history.length - 1;
    g.fillStyle = PAL.warn;
    g.beginPath();
    g.arc(x(last), y(history[last]), 3, 0, Math.PI * 2);
    g.fill();
  }
  return h('figure', { class: 'spark-fig' }, c, h('figcaption', null, 'Frustration au fil de la journée (%)'));
}

export interface DebriefInfo {
  gained: number;
  rankUp: string | null;
  next: LevelDef | null;
}

export function showDebrief(
  host: HTMLElement,
  level: LevelDef,
  result: MissionResult,
  sim: Simulation,
  info: DebriefInfo,
  on: { replay: () => void; next: () => void; campaign: () => void },
): void {
  const st = sim.stats;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const okRate = st.transactions ? (st.good + st.late) / st.transactions : 0;
  const checks = (items: { label: string; ok: boolean; detail: string }[]) =>
    h('ul', { class: 'checks' }, ...items.map((o) => h('li', { class: o.ok ? 'ok' : 'ko' }, h('span', null, o.label), h('small', null, o.detail))));
  const stats: [string, string][] = [
    ['Requêtes servies', `${pct(okRate)} de ${st.transactions}`],
    ['Requêtes perdues', pct(result.lossRate)],
    ['Frustration moyenne · pic', `${Math.round(result.avgFrustration)} % · ${Math.round(result.peakFrustration)} %`],
    ['Budget dépensé', `${euros(result.spent)} / ${euros(level.budget)}`],
  ];
  if (st.probes) stats.push(['Sondes bloquées', `${st.probesBlocked}/${st.probes} · ${st.breaches} brèche(s)`]);
  if (st.attackPackets) stats.push(['Paquets d’attaque bloqués', `${st.attackBlocked}/${st.attackPackets}`]);
  if (st.infectedTotal) stats.push(['Postes infectés', String(st.infectedTotal)]);
  if (st.overheats) stats.push(['Surchauffes', String(st.overheats)]);

  const actions: ModalAction[] = [
    { label: 'Carrière', onClick: on.campaign },
    { label: result.success ? 'Rejouer' : 'Revoir le plan', kind: result.success && info.next ? 'ghost' : 'primary', onClick: on.replay },
  ];
  if (result.success && info.next) actions.push({ label: 'Mission suivante', kind: 'primary', onClick: on.next });

  openModal(host, {
    eyebrow: `${level.company} · ${level.title}`,
    title: result.success ? 'Mission réussie' : 'Journée perdue',
    wide: true,
    dismissible: false,
    className: `debrief ${result.success ? 'win' : 'lose'}`,
    body: [
      h('div', { class: 'debrief-head' }, stars(result.stars), result.failReason ? h('p', { class: 'fail' }, result.failReason) : null),
      h(
        'div',
        { class: 'debrief-grid' },
        h('div', null, h('h4', null, 'Objectifs'), checks(result.objectives), h('h4', null, 'Étoiles bonus'), checks(result.starRules)),
        h('div', null, h('dl', { class: 'stat-list' }, ...stats.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])), sparkline(sim.history, Math.ceil(sim.dayLength))),
      ),
      info.gained ? h('p', { class: 'gain' }, `+${info.gained} point${info.gained > 1 ? 's' : ''} de compétence à dépenser dans l’arbre.`) : null,
      info.rankUp ? h('p', { class: 'gain' }, `Promotion : tu es désormais ${info.rankUp}.`) : null,
    ],
    actions,
  });
}
