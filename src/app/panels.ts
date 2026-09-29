// Side panel: guide, objectives, inspector, diagnostics, configuration and alerts.

import { loc, pct, pctN, T } from '../i18n/index.ts';
import { CABLES, DEVICES, euros, gbps, meters, tempCelsius } from '../core/catalog.ts';
import {
  cloneConfig,
  computeAddressing,
  formatRule,
  parseService,
  type NetConfig,
} from '../core/config.ts';
import { cableCurrentCost, designCost, isEquipment, portsUsed, type Design } from '../core/design.ts';
import type { Issue } from '../core/diagnostics.ts';
import { formatIp, usableHosts } from '../core/ip.ts';
import type { GuideState } from '../core/guide.ts';
import { groupName, hasFeature, roomAt, type LevelDef } from '../core/level.ts';
import type { NetNode, Network } from '../core/network.ts';
import { objectiveLabel, starLabel } from '../core/objectives.ts';
import type { Simulation } from '../core/simulation.ts';
import type { LbMode, NodeKind, Phase, SkillId } from '../core/types.ts';
import { drawGlyph, PAL } from '../render/glyphs.ts';
import { h } from './dom.ts';

export interface PanelCtx {
  level: LevelDef;
  skills: ReadonlySet<SkillId>;
  phase: Phase;
  design: Design;
  config: NetConfig;
  net: Network;
  sim: Simulation | null;
  issues: Issue[];
  selected: { node?: string; link?: string };
  guide: GuideState;
  setConfig(c: NetConfig): void;
  run(cmd: string): void;
  select(node?: string, link?: string): void;
  autoCable(hub: string): void;
  removeNode(id: string): void;
  removeLink(id: string): void;
  goPhase(p: Phase): void;
  launch(): void;
  stop(): void;
}

export interface Card {
  el: HTMLElement;
  update?: () => void;
}

function kindName(kind: NodeKind): string {
  return kind in DEVICES ? DEVICES[kind as keyof typeof DEVICES].name : T.catalog.kinds[kind as keyof typeof T.catalog.kinds];
}

export function glyphIcon(kind: NodeKind, size = 34, stroke = PAL.equipStroke): HTMLCanvasElement {
  const c = h('canvas', { class: 'glyph-icon', width: String(size * 2), height: String(size * 2), aria: { hidden: 'true' } });
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const g = c.getContext('2d');
  if (g) {
    g.scale(2, 2);
    drawGlyph(g, kind, size / 2, size / 2, size * 0.62, { stroke, fill: PAL.equipFill, ports: { used: 3, total: 8 } });
  }
  return c;
}

function card(title: string, tut: string, ...children: (Node | string | null | false | undefined)[]): HTMLElement {
  return h('section', { class: 'card', data: { tut } }, h('h3', { class: 'card-title' }, title), ...children);
}

function row(label: string, value: Node | string): HTMLElement[] {
  return [h('dt', null, label), h('dd', null, value)];
}

// ---------------------------------------------------------------------------
// Guide and tips

export function guideCard(ctx: PanelCtx): Card | null {
  const steps = ctx.level.guide;
  if (steps && ctx.phase !== 'live') {
    const list = h('ol', { class: 'guide' });
    const update = () => {
      const s = ctx.guide;
      let current = false;
      list.replaceChildren(
        ...steps.map((st) => {
          const done = st.done?.(s) ?? false;
          const isCurrent = !done && !current;
          if (isCurrent) current = true;
          return h('li', { class: done ? 'done' : isCurrent ? 'current' : '' }, loc(st.text));
        }),
      );
    };
    update();
    return { el: card(T.panels.guide, 'card-guide', list), update };
  }
  if (ctx.phase === 'live' || !ctx.level.tips.length) return null;
  return { el: card(T.panels.tips, 'card-tips', h('ul', { class: 'tips' }, ...ctx.level.tips.map((t) => h('li', null, loc(t))))) };
}

// ---------------------------------------------------------------------------
// Objectives

export function objectivesCard(ctx: PanelCtx): Card {
  const list = h('ul', { class: 'objectives' });
  const update = () => {
    const sim = ctx.sim;
    const spent = designCost(ctx.level, ctx.design);
    const items: HTMLElement[] = [];
    for (const o of ctx.level.objectives) {
      let live = '';
      let state: 'ok' | 'ko' | '' = '';
      if (sim) {
        if (o.kind === 'survive') live = T.panels.frustration(sim.frustration);
        if (o.kind === 'noBreach') {
          live = T.panels.breaches(sim.stats.breaches);
          state = sim.stats.breaches ? 'ko' : '';
        }
        if (o.kind === 'infected') {
          live = T.panels.infected(sim.stats.infectedTotal, o.max);
          state = sim.stats.infectedTotal > o.max ? 'ko' : '';
        }
        if (o.kind === 'service') {
          const total = sim.stats.poolTotal[o.pool] ?? 0;
          const okN = sim.stats.poolOk[o.pool] ?? 0;
          live = total ? pct(okN / total) : '—';
        }
        if (o.kind === 'incidents') {
          const f = sim.incidents.filter((i) => i.kind === 'failure');
          live = f.length ? `${f.filter((i) => i.resolved !== undefined && !i.missed).length}/${f.length}` : T.panels.noFailure;
          state = f.some((i) => i.missed) ? 'ko' : '';
        }
      }
      items.push(h('li', { class: `obj ${state}` }, h('span', null, objectiveLabel(o, ctx.level)), live ? h('small', null, live) : null));
    }
    items.push(h('li', { class: 'obj-sep' }, T.panels.bonusStars));
    for (const s of ctx.level.stars) {
      let live = '';
      let state: 'ok' | 'ko' | '' = '';
      if (s.kind === 'spent') {
        live = euros(spent);
        state = spent <= s.max ? 'ok' : 'ko';
      } else if (sim && s.kind === 'avgFrustration') {
        live = pctN(sim.averageFrustration);
        state = sim.averageFrustration <= s.max ? 'ok' : 'ko';
      } else if (sim && s.kind === 'lossRate') {
        const r = sim.stats.transactions ? sim.stats.failed / sim.stats.transactions : 0;
        live = pct(r);
        state = r <= s.max ? 'ok' : 'ko';
      } else if (sim && s.kind === 'mitigation') {
        const d = sim.incidents.filter((i) => i.kind === 'ddos');
        live = d.length ? d.map((i) => (i.resolved !== undefined ? `${Math.round(i.resolved - i.start)} s` : T.panels.inProgress)).join(', ') : T.panels.notYet;
      }
      items.push(h('li', { class: `obj star ${state}` }, h('span', null, `★ ${starLabel(s)}`), live ? h('small', null, live) : null));
    }
    list.replaceChildren(...items);
  };
  update();
  return { el: card(T.panels.objectives, 'card-objectives', list), update };
}

// ---------------------------------------------------------------------------
// Diagnostics

export function diagnosticsCard(ctx: PanelCtx): Card {
  const issues = ctx.issues;
  const body = issues.length
    ? h(
        'ul',
        { class: 'issues' },
        ...issues.map((i) =>
          h(
            'li',
            { class: `issue ${i.level}` },
            i.nodes?.length
              ? h('button', { class: 'linkish', type: 'button', on: { click: () => ctx.select(i.nodes![0]) } }, i.text)
              : h('span', null, i.text),
          ),
        ),
      )
    : h('p', { class: 'all-good' }, T.panels.allGood);
  return { el: card(`${T.panels.diagnostics}${issues.length ? ` · ${issues.length}` : ''}`, 'card-diagnostics', body) };
}

// ---------------------------------------------------------------------------
// Inspector

function nodeTitle(n: NetNode): HTMLElement {
  return h('div', { class: 'insp-head' }, glyphIcon(n.kind), h('div', null, h('b', null, n.label), h('small', null, kindName(n.kind))));
}

export function inspectorCard(ctx: PanelCtx): Card | null {
  const { node, link } = ctx.selected;
  if (link) {
    const l = ctx.net.linkById.get(link);
    if (!l) return null;
    const a = ctx.net.byId.get(l.a)!;
    const b = ctx.net.byId.get(l.b)!;
    const util = h('dd', null, '—');
    const cable = ctx.design.cables.find((c) => c.id === l.cableId);
    const dl = h(
      'dl',
      { class: 'props' },
      ...row(T.panels.connects, `${a.label} ↔ ${b.label}`),
      ...row(T.panels.length, meters(l.length)),
      ...row(T.panels.bandwidth, gbps(l.capacity)),
      ...(cable ? row(T.panels.cost, euros(cableCurrentCost(ctx.level, ctx.design, cable))) : []),
      h('dt', null, T.panels.utilization),
      util,
    );
    const update = () => {
      util.textContent = ctx.sim ? pct(ctx.sim.linkUtil(l.id)) : T.panels.notStarted;
    };
    update();
    const title = l.kind === 'wifi' ? T.panels.wifiLink : CABLES[l.kind].name;
    return {
      el: card(
        T.panels.selection,
        'card-inspector',
        h('div', { class: 'insp-head' }, h('div', null, h('b', null, title), h('small', null, l.broken ? T.panels.tooLongInactive : T.panels.cable))),
        dl,
        cable && ctx.phase !== 'live'
          ? h('div', { class: 'actions' }, h('button', { class: 'btn danger small', type: 'button', on: { click: () => ctx.removeLink(l.id) } }, T.panels.deleteCable))
          : null,
      ),
      update,
    };
  }
  if (!node) return null;
  const n = ctx.net.byId.get(node);
  if (!n) return null;
  const addr = computeAddressing(ctx.level, ctx.config);
  const room = roomAt(ctx.level, n.cell.x, n.cell.y);
  const props: HTMLElement[] = [];
  const P = T.panels;
  props.push(...row(P.room, room ? `${loc(room.name)}${room.kind === 'server' ? P.airConditioned : ''}` : P.corridor));
  if (n.group) props.push(...row(P.group, groupName(ctx.level, n.group)));
  if (n.ports) props.push(...row(P.ports, `${portsUsed(ctx.design, n.id)} / ${n.ports}`));
  if (n.transit) props.push(...row(P.bandwidth, gbps(n.capacity)));
  if (n.kind === 'server') props.push(...row(P.capacity, P.requestsPerSec(n.capacity)), ...row(P.service, `${n.service!.proto.toUpperCase()}/${n.service!.port}`));
  if (n.kind === 'internet') props.push(...row(P.subscription, gbps(n.isp ?? 0)));
  if (n.wifi) props.push(...row(P.wifi, P.wifiClients(ctx.net.wifiClients.get(n.id)?.length ?? 0, n.wifi.clients, meters(n.wifi.radius))));
  if (n.endpoint && n.kind !== 'internet') {
    const ip = addr.ipOf.get(n.id);
    props.push(...row('VLAN', String(addr.vlanOf.get(n.id) ?? '—')), ...row(P.ipAddress, ip === undefined ? P.none : formatIp(ip)));
  }
  if (n.kind === 'laptop' && ctx.net.uncovered.includes(n.id)) props.push(...row(P.wifi, P.outOfRange));
  if (n.l3) props.push(...row(P.role, n.nat ? P.roleNat : P.roleL3));

  const live = h('dl', { class: 'props live' });
  const actions = h('div', { class: 'actions' });
  const traffic = h('div', { class: 'traffic-table' });

  const update = () => {
    const sim = ctx.sim;
    if (!sim) {
      live.replaceChildren();
      return;
    }
    const st = sim.states.get(n.id);
    if (!st) return;
    const rows: HTMLElement[] = [];
    const S = T.panels.states;
    const state = st.down === 'failure' ? S.down : st.down === 'overheat' ? S.overheat : st.quarantined ? S.quarantined : st.infected ? S.infected : S.ok;
    rows.push(...row(T.panels.state, h('span', { class: state === S.ok ? 'ok' : 'crit' }, state)));
    if (n.transit || n.kind === 'server') {
      rows.push(
        ...row(T.panels.load, pct(Math.min(1, st.load))),
        ...row(T.panels.temperature, `${tempCelsius(st.heat)} °C`),
        ...row(T.panels.queue, T.panels.packets(sim.queued(st))),
      );
    }
    live.replaceChildren(...rows);
    if (n.l3 && hasFeature(ctx.level, 'firewall')) {
      const top = sim.topPorts().slice(0, 5);
      traffic.replaceChildren(
        h('p', { class: 'mini-title' }, T.panels.observed),
        ...top.map((t) =>
          h(
            'div',
            { class: `traffic-row ${t.anomalous ? 'anomalous' : ''}` },
            h('code', null, `${t.anomalous ? '⚠ ' : ''}${t.key.toUpperCase()}`),
            h('span', null, String(t.pps)),
            t.key.endsWith('/443') || t.key.endsWith('/445')
              ? h('span', { class: 'muted' }, '—')
              : h('button', { class: 'btn ghost tiny', type: 'button', on: { click: () => ctx.run(`block ${t.key.replace('/', ' ')}`) } }, T.panels.block),
          ),
        ),
      );
    }
  };

  const rebuildActions = () => {
    const sim = ctx.sim;
    const btns: HTMLElement[] = [];
    if (!sim && ctx.phase !== 'live') {
      if (isEquipment(n.kind) && n.kind !== 'ap') {
        btns.push(h('button', { class: 'btn primary small', type: 'button', data: { tut: 'autocable' }, on: { click: () => ctx.autoCable(n.id) } }, T.panels.autoCable));
      }
      if (!n.fixed) {
        btns.push(
          h('button', { class: 'btn danger small', type: 'button', on: { click: () => ctx.removeNode(n.id) } }, T.panels.deleteDevice(euros(DEVICES[n.kind as keyof typeof DEVICES].cost))),
        );
      }
    } else if (sim) {
      const st = sim.states.get(n.id);
      if (st?.down === 'failure' || (st && n.endpoint && (st.infected || st.quarantined))) {
        btns.push(h('button', { class: 'btn primary small', type: 'button', data: { tut: 'dispatch' }, on: { click: () => ctx.run(`dispatch ${n.id}`) } }, T.panels.sendTech));
      }
      if ((n.kind === 'workstation' || n.kind === 'laptop') && hasFeature(ctx.level, 'quarantine')) {
        btns.push(
          ctx.config.quarantine.includes(n.id)
            ? h('button', { class: 'btn ghost small', type: 'button', on: { click: () => ctx.run(`release ${n.id}`) } }, T.panels.release)
            : h('button', { class: 'btn danger small', type: 'button', data: { tut: 'quarantine' }, on: { click: () => ctx.run(`quarantine ${n.id}`) } }, T.panels.isolate),
        );
      }
    }
    actions.replaceChildren(...btns);
  };
  update();
  rebuildActions();
  return {
    el: card(T.panels.selection, 'card-inspector', nodeTitle(n), h('dl', { class: 'props' }, ...props), live, traffic, actions),
    update: () => {
      update();
      rebuildActions();
    },
  };
}

// ---------------------------------------------------------------------------
// Configuration

function vlanSection(ctx: PanelCtx): HTMLElement {
  const lvl = ctx.level;
  const manual = lvl.addressing.mode === 'manual';
  const canVlan = hasFeature(lvl, 'vlan');
  const subnetsBox = h('div', { class: 'subnets' });

  const renderSubnets = () => {
    const addr = computeAddressing(lvl, ctx.config);
    if (!manual) {
      subnetsBox.replaceChildren(
        h('p', { class: 'muted' }, T.panels.autoAddressing),
      );
      return;
    }
    const rows = addr.vlans.map((v) => {
      const input = h('input', {
        class: 'cidr',
        id: `subnet-${v.vlan}`,
        type: 'text',
        value: ctx.config.subnets[String(v.vlan)] ?? '',
        placeholder: T.panels.subnetPlaceholder,
        spellcheck: 'false',
        aria: { label: T.panels.subnetAria(v.vlan) },
      });
      const status = h('span', { class: `status ${v.ok ? 'ok' : 'ko'}` }, v.ok ? T.panels.subnetOk(v.hosts, Math.max(0, v.usable - 1 - v.hosts)) : `✖ ${v.error}${v.hint ? ` ${v.hint}` : ''}`);
      input.addEventListener('change', () => {
        const next = cloneConfig(ctx.config);
        const val = input.value.trim();
        if (val) next.subnets[String(v.vlan)] = val;
        else delete next.subnets[String(v.vlan)];
        ctx.setConfig(next);
        renderSubnets();
      });
      return h(
        'div',
        { class: 'subnet-row' },
        h('label', { for: `subnet-${v.vlan}` }, `VLAN ${v.vlan}`, h('small', null, v.groups.map((g) => groupName(lvl, g)).join(', '))),
        input,
        status,
      );
    });
    subnetsBox.replaceChildren(
      h('p', { class: 'mini-title' }, T.panels.subnetsTitle(lvl.addressing.mode === 'manual' ? lvl.addressing.block : '')),
      ...rows,
      h('p', { class: 'cheat' }, T.panels.cheat(usableHosts(27), usableHosts(28), usableHosts(29), usableHosts(30))),
    );
  };

  const groupRows = lvl.groups.map((g) => {
    const members = lvl.endpoints.filter((e) => e.group === g.id);
    const count = members.length;
    const servers = members.every((e) => e.kind === 'server');
    const input = h('input', {
      class: 'vlan',
      id: `vlan-${g.id}`,
      type: 'number',
      min: '1',
      max: '4094',
      value: String(ctx.config.vlans[g.id] ?? 1),
      disabled: !canVlan,
      aria: { label: T.panels.vlanAria(loc(g.name)) },
    });
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      if (!Number.isFinite(v) || v < 1 || v > 4094) {
        input.value = String(ctx.config.vlans[g.id] ?? 1);
        return;
      }
      const next = cloneConfig(ctx.config);
      next.vlans[g.id] = v;
      ctx.setConfig(next);
      renderSubnets();
    });
    return h(
      'div',
      { class: 'vlan-row' },
      h('label', { for: `vlan-${g.id}` }, h('i', { class: 'swatch', style: `--c:${g.color}` }), loc(g.name), h('small', null, T.panels.members(count, servers))),
      input,
    );
  });
  renderSubnets();
  const auto = ctx.skills.has('autovlan') && canVlan
    ? h('button', { class: 'btn ghost small', type: 'button', on: { click: () => ctx.run('autovlan') } }, T.panels.autoVlan)
    : null;
  return h(
    'div',
    { class: 'cfg-section' },
    h('p', { class: 'mini-title' }, canVlan ? T.panels.vlanPerGroup : T.panels.vlanLater),
    ...groupRows,
    auto,
    subnetsBox,
  );
}

function selectorOptions(ctx: PanelCtx): { value: string; label: string }[] {
  const lvl = ctx.level;
  const opts = [
    { value: 'any', label: T.panels.any },
    { value: 'internet', label: T.panels.internet },
  ];
  for (const g of lvl.groups) opts.push({ value: g.id, label: T.panels.groupOpt(loc(g.name)) });
  for (const pool of [...new Set(lvl.endpoints.filter((e) => e.pool).map((e) => e.pool!))]) opts.push({ value: pool, label: T.panels.serviceOpt(pool.toUpperCase()) });
  for (const v of [...new Set(Object.values(ctx.config.vlans))].sort((a, b) => a - b)) opts.push({ value: `vlan${v}`, label: `VLAN ${v}` });
  return opts;
}

function firewallSection(ctx: PanelCtx, compact = false): HTMLElement {
  const rules = ctx.config.rules;
  const hits = ctx.sim?.ruleHits;
  const list = rules.length
    ? h(
        'ol',
        { class: 'rules' },
        ...rules.map((r, i) =>
          h(
            'li',
            { class: r.action },
            h('span', { class: 'rule-text' }, formatRule(r)),
            hits ? h('small', null, `${hits.get(r.id) ?? 0}`) : null,
            i > 0 ? h('button', { class: 'icon-btn', type: 'button', title: T.panels.moveUp, aria: { label: T.panels.moveUpAria }, on: { click: () => ctx.run(`fw up ${i + 1}`) } }, '↑') : null,
            h('button', { class: 'icon-btn', type: 'button', title: T.panels.remove, aria: { label: T.panels.removeAria }, on: { click: () => ctx.run(`fw del ${i + 1}`) } }, '✕'),
          ),
        ),
      )
    : h('p', { class: 'muted' }, T.panels.noRules);
  const opts = selectorOptions(ctx);
  const sel = (id: string, label: string, def: string) =>
    h(
      'select',
      { id, aria: { label } },
      ...opts.map((o) => {
        const opt = h('option', { value: o.value }, o.label);
        if (o.value === def) opt.selected = true;
        return opt;
      }),
    );
  const P = T.panels;
  const action = h('select', { id: 'fw-action', aria: { label: P.action } }, h('option', { value: 'deny' }, P.deny), h('option', { value: 'allow' }, P.allow));
  const src = sel('fw-src', P.source, 'any');
  const dst = sel('fw-dst', P.destination, 'any');
  const svc = h('input', { id: 'fw-svc', type: 'text', placeholder: P.servicePlaceholder, spellcheck: 'false', aria: { label: P.service } });
  const add = h('form', { class: 'rule-form', data: { tut: 'fw-form' } }, action, src, h('span', { class: 'arrow' }, '→'), dst, svc, h('button', { class: 'btn primary small', type: 'submit' }, P.add));
  add.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = svc.value.trim();
    if (s && !parseService(s)) {
      svc.setCustomValidity(P.serviceExamples);
      svc.reportValidity();
      return;
    }
    svc.setCustomValidity('');
    ctx.run(`fw ${action.value} ${src.value} ${dst.value}${s ? ` ${s}` : ''}`);
  });
  const quick = h('form', { class: 'quick-block' });
  const proto = h('select', { id: 'qb-proto', aria: { label: P.protocol } }, h('option', { value: 'udp' }, 'UDP'), h('option', { value: 'tcp' }, 'TCP'));
  const port = h('input', { id: 'qb-port', type: 'number', min: '1', max: '65535', placeholder: P.portPlaceholder, aria: { label: P.port } });
  const range = h('input', { id: 'qb-range', type: 'text', placeholder: P.rangePlaceholder, spellcheck: 'false', aria: { label: P.range } });
  quick.append(
    h('span', { class: 'mini-title' }, P.quickBlock),
    proto,
    port,
    h('button', { class: 'btn danger small', type: 'submit' }, P.port),
    range,
    h(
      'button',
      {
        class: 'btn danger small',
        type: 'button',
        on: {
          click: () => {
            if (range.value.trim()) ctx.run(`blockip ${range.value.trim()}`);
          },
        },
      },
      P.rangeBtn,
    ),
  );
  quick.addEventListener('submit', (e) => {
    e.preventDefault();
    if (port.value) ctx.run(`block ${proto.value} ${port.value}`);
  });
  return h(
    'div',
    { class: 'cfg-section' },
    h('p', { class: 'mini-title' }, P.firewall),
    h('p', { class: 'hint-line' }, P.firewallHint),
    list,
    compact ? null : add,
    quick,
  );
}

function lbSection(ctx: PanelCtx): HTMLElement | null {
  const pools = [...new Set(ctx.level.endpoints.filter((e) => e.pool).map((e) => e.pool!))];
  const multi = pools.filter((p) => ctx.level.endpoints.filter((e) => e.pool === p).length > 1);
  if (!multi.length) return null;
  const names: Record<LbMode, string> = T.panels.lbModes;
  return h(
    'div',
    { class: 'cfg-section' },
    h('p', { class: 'mini-title' }, T.panels.loadBalancing),
    ...multi.map((p) => {
      const n = ctx.level.endpoints.filter((e) => e.pool === p).length;
      const select = h(
        'select',
        { id: `lb-${p}`, data: { tut: `lb-${p}` }, aria: { label: T.panels.lbAria(p) } },
        ...(['none', 'rr', 'least'] as LbMode[]).map((m) => {
          const locked = m === 'least' && !ctx.skills.has('lb_least');
          const opt = h('option', { value: m, disabled: locked }, `${names[m]}${locked ? T.panels.skillTag : ''}`);
          if ((ctx.config.lb[p] ?? 'none') === m) opt.selected = true;
          return opt;
        }),
      );
      select.addEventListener('change', () => ctx.run(`lb ${p} ${select.value}`));
      return h('div', { class: 'vlan-row' }, h('label', { for: `lb-${p}` }, p.toUpperCase(), h('small', null, T.panels.servers(n))), select);
    }),
  );
}

export function configCard(ctx: PanelCtx): Card {
  const lvl = ctx.level;
  const parts: (HTMLElement | null)[] = [];
  if (hasFeature(lvl, 'vlan') || hasFeature(lvl, 'subnets')) parts.push(vlanSection(ctx));
  if (hasFeature(lvl, 'firewall')) parts.push(firewallSection(ctx));
  if (hasFeature(lvl, 'lb')) parts.push(lbSection(ctx));
  if (!parts.some(Boolean)) {
    parts.push(
      h(
        'div',
        { class: 'cfg-section' },
        h('p', null, T.panels.nothingToConfigure),
        h('p', { class: 'muted' }, T.panels.testAnyway, h('code', null, 'ping pc-1 internet'), T.panels.or, h('code', null, 'traceroute pc-1 nas'), '.'),
      ),
    );
  }
  return { el: card(T.panels.configuration, 'card-config', ...parts) };
}

export function liveFirewallCard(ctx: PanelCtx): Card | null {
  if (!hasFeature(ctx.level, 'firewall')) return null;
  return { el: card(T.panels.liveFirewall, 'card-firewall', firewallSection(ctx, true), lbSection(ctx)) };
}

// ---------------------------------------------------------------------------
// Live alerts

export function alertsCard(ctx: PanelCtx): Card {
  const list = h('ul', { class: 'alerts' });
  let seen = -1;
  const update = () => {
    const sim = ctx.sim;
    if (!sim || sim.logVersion === seen) return;
    seen = sim.logVersion;
    const entries = sim.log.filter((l) => l.level !== 'info').slice(-6).reverse();
    list.replaceChildren(
      ...(entries.length
        ? entries.map((e) =>
            h(
              'li',
              { class: e.level },
              h('span', { class: 'ts' }, sim.clockAt(e.t)),
              h('span', null, e.text),
              e.action ? h('button', { class: 'btn primary tiny', type: 'button', on: { click: () => ctx.run(e.action!.cmd) } }, e.action.label) : null,
            ),
          )
        : [h('li', { class: 'calm' }, T.panels.calm)]),
    );
  };
  update();
  return { el: card(T.panels.alerts, 'card-alerts', list), update };
}

// ---------------------------------------------------------------------------
// Panel footer: main action of the phase

export function phaseFooter(ctx: PanelCtx): HTMLElement {
  if (ctx.phase === 'live') {
    return h('div', { class: 'side-foot' }, h('button', { class: 'btn danger', type: 'button', on: { click: () => ctx.stop() } }, T.panels.stopDay));
  }
  const cost = designCost(ctx.level, ctx.design);
  const over = cost > ctx.level.budget;
  return h(
    'div',
    { class: 'side-foot' },
    ctx.phase === 'build'
      ? h('button', { class: 'btn ghost', type: 'button', on: { click: () => ctx.goPhase('config') } }, T.panels.toConfig)
      : h('button', { class: 'btn ghost', type: 'button', on: { click: () => ctx.goPhase('build') } }, T.panels.toBuild),
    h('button', { class: 'btn primary', type: 'button', disabled: over, title: over ? T.panels.overBudget : '', data: { tut: 'launch' }, on: { click: () => ctx.launch() } }, T.panels.launch),
  );
}
