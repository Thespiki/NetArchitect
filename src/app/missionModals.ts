// Mission briefing and end-of-day debrief (objectives, score, tier, server verification).

import { euros, loc, num, pct, pctN, T } from '../i18n/index.ts';
import { rankName, type LevelDef } from '../core/level.ts';
import { objectiveLabel, starLabel, type MissionResult } from '../core/objectives.ts';
import type { RunResponse } from '../core/protocol.ts';
import { nextTier, tierFor, type ScoreBreakdown } from '../core/score.ts';
import type { Simulation } from '../core/simulation.ts';
import { FONT_MONO, hexAlpha, PAL } from '../render/glyphs.ts';
import { h, stars } from './dom.ts';
import { openModal, type ModalAction } from './modal.ts';

export function showBriefing(
  host: HTMLElement,
  level: LevelDef,
  restored: boolean,
  on: { start: () => void; back: () => void; skip?: () => void },
): void {
  const B = T.briefing;
  const users = level.endpoints.filter((e) => e.kind === 'workstation' || e.kind === 'laptop').length;
  const servers = level.endpoints.filter((e) => e.kind === 'server').length;
  const actions: ModalAction[] = [{ label: B.backCareer, onClick: on.back }];
  if (on.skip) actions.push({ label: B.skipTraining, onClick: on.skip });
  actions.push({ label: B.start, kind: 'primary', onClick: on.start });
  openModal(host, {
    eyebrow: level.order === 0 ? T.campaign.training : B.eyebrow(String(level.order).padStart(2, '0'), rankName(level.order)),
    title: `${level.company} — ${loc(level.title)}`,
    wide: true,
    dismissible: false,
    className: 'briefing',
    body: [
      ...level.brief.map((p) => h('p', { class: 'brief' }, loc(p))),
      h(
        'dl',
        { class: 'facts' },
        h('div', null, h('dt', null, B.budget), h('dd', null, euros(level.budget))),
        h('div', null, h('dt', null, B.users), h('dd', null, String(users))),
        h('div', null, h('dt', null, B.servers), h('dd', null, String(servers))),
        h('div', null, h('dt', null, B.day), h('dd', null, B.dayLength(Math.round(level.dayLength)))),
      ),
      level.newMechanics.length
        ? h('div', { class: 'mechanics' }, ...level.newMechanics.map((m) => h('article', null, h('h4', null, loc(m.title)), h('p', null, loc(m.text)))))
        : null,
      h(
        'div',
        { class: 'brief-goals' },
        h('div', null, h('h4', null, B.objectives), h('ul', null, ...level.objectives.map((o) => h('li', null, objectiveLabel(o, level))))),
        h('div', null, h('h4', null, B.bonusStars), h('ul', null, ...level.stars.map((s) => h('li', null, `★ ${starLabel(s)}`)))),
      ),
      restored ? h('p', { class: 'muted' }, B.restored) : null,
    ],
    actions,
  });
}

function sparkline(history: number[], dayLength: number): HTMLElement {
  const W = 400;
  const H = 128;
  const D = T.debrief;
  const c = h('canvas', { class: 'spark', width: String(W * 2), height: String(H * 2), role: 'img' });
  c.setAttribute('aria-label', D.sparkAria(Math.max(0, ...history)));
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
  g.textBaseline = 'top';
  const aligns: CanvasTextAlign[] = ['left', 'center', 'right'];
  D.ticks.forEach((label, i) => {
    g.textAlign = aligns[i];
    g.fillText(label, padL + (i / 2) * plotW, H - padB + 6);
  });
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
  return h('figure', { class: 'spark-fig' }, c, h('figcaption', null, D.sparkCaption));
}

export interface DebriefInfo {
  gained: number;
  rankUp: string | null;
  next: LevelDef | null;
  score: ScoreBreakdown;
  /** Score before this day: shows "new record" and the tier change. */
  previousBest: number;
  /** Career totals before and after this day. */
  totalBefore: number;
  totalAfter: number;
  /** Server verdict, when the player is signed in. */
  verification: Promise<RunResponse | null> | null;
}

function scoreBlock(level: LevelDef, info: DebriefInfo): HTMLElement | null {
  if (level.order === 0) return h('p', { class: 'muted fine' }, T.score.trainingNote);
  const S = T.score;
  const s = info.score;
  if (!s.total) return null;
  const rows: [string, number][] = [
    [S.completion, s.completion],
    [S.stars, s.stars],
    [S.satisfaction, s.satisfaction],
    [S.reliability, s.reliability],
    [S.savings, s.savings],
  ];
  const record = s.total > info.previousBest;
  const tierBefore = tierFor(info.totalBefore);
  const tierAfter = tierFor(info.totalAfter);
  const next = nextTier(info.totalAfter);
  const verify = h('p', { class: 'verify', role: 'status' });
  if (info.verification) {
    verify.textContent = T.ranking.verifying;
    verify.dataset.state = 'pending';
    info.verification.then(
      (res) => {
        if (!res) {
          verify.remove();
          return;
        }
        if (res.accepted) {
          verify.dataset.state = 'ok';
          verify.textContent = `✔ ${T.ranking.verified} · ${T.ranking.missionRank(res.missionRank)} · ${T.ranking.worldRank(res.rank)}`;
        } else {
          verify.dataset.state = 'ko';
          verify.textContent = T.ranking.rejected(res.reason);
        }
      },
      () => verify.remove(),
    );
  } else verify.hidden = true;
  return h(
    'section',
    { class: 'score-block' },
    h('h4', null, S.title, record ? h('span', { class: 'record' }, S.newRecord) : null),
    h('dl', { class: 'score-list' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, `+${num(v)}`)]), h('dt', { class: 'total' }, S.total), h('dd', { class: 'total' }, num(s.total))),
    h(
      'p',
      { class: 'tier-line' },
      h('span', { class: 'tier-badge', style: `--tier:${tierAfter.color}` }, T.tiers[tierAfter.id]),
      tierAfter.id !== tierBefore.id ? h('b', { class: 'tier-up' }, ' ▲') : null,
      ` ${S.career} ${num(info.totalAfter)}`,
      next ? h('small', { class: 'muted' }, ` · ${S.toNext(next.missing, T.tiers[next.tier.id])}`) : h('small', { class: 'muted' }, ` · ${S.top}`),
    ),
    verify,
  );
}

export function showDebrief(
  host: HTMLElement,
  level: LevelDef,
  result: MissionResult,
  sim: Simulation,
  info: DebriefInfo,
  on: { replay: () => void; next: () => void; campaign: () => void },
): void {
  const D = T.debrief;
  const st = sim.stats;
  const okRate = st.transactions ? (st.good + st.late) / st.transactions : 0;
  const checks = (items: { label: string; ok: boolean; detail: string }[]) =>
    h('ul', { class: 'checks' }, ...items.map((o) => h('li', { class: o.ok ? 'ok' : 'ko' }, h('span', null, o.label), h('small', null, o.detail))));
  const stats: [string, string][] = [
    [D.served, D.servedValue(pct(okRate), st.transactions)],
    [D.lost, pct(result.lossRate)],
    [D.frustration, `${pctN(result.avgFrustration)} · ${pctN(result.peakFrustration)}`],
    [D.spent, `${euros(result.spent)} / ${euros(level.budget)}`],
  ];
  if (st.probes) stats.push([D.probes, D.probesValue(st.probesBlocked, st.probes, st.breaches)]);
  if (st.attackPackets) stats.push([D.attack, `${st.attackBlocked}/${st.attackPackets}`]);
  if (st.infectedTotal) stats.push([D.infected, String(st.infectedTotal)]);
  if (st.overheats) stats.push([D.overheats, String(st.overheats)]);

  const actions: ModalAction[] = [
    { label: D.career, onClick: on.campaign },
    { label: result.success ? D.replay : D.review, kind: result.success && info.next ? 'ghost' : 'primary', onClick: on.replay },
  ];
  if (result.success && info.next) actions.push({ label: D.next, kind: 'primary', onClick: on.next });

  const training = level.order === 0;
  openModal(host, {
    eyebrow: `${level.company} · ${loc(level.title)}`,
    title: result.success ? (training ? D.trainingDone : D.success) : D.failure,
    wide: true,
    dismissible: false,
    className: `debrief ${result.success ? 'win' : 'lose'}`,
    body: [
      h('div', { class: 'debrief-head' }, stars(result.stars), result.failReason ? h('p', { class: 'fail' }, result.failReason) : null),
      h(
        'div',
        { class: 'debrief-grid' },
        h('div', null, h('h4', null, D.objectives), checks(result.objectives), h('h4', null, D.bonusStars), checks(result.starRules), scoreBlock(level, info)),
        h('div', null, h('dl', { class: 'stat-list' }, ...stats.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])), sparkline(sim.history, Math.ceil(sim.dayLength))),
      ),
      info.gained ? h('p', { class: 'gain' }, D.gained(info.gained)) : null,
      info.rankUp ? h('p', { class: 'gain' }, D.promotion(info.rankUp)) : null,
    ],
    actions,
  });
}
