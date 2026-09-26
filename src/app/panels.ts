// Panneau latéral : guide, objectifs, inspecteur, diagnostic, configuration et alertes.

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
import { groupName, hasFeature, roomAt, type GuideState, type LevelDef } from '../core/level.ts';
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

const KIND_NAMES: Record<NodeKind, string> = {
  workstation: 'Poste de travail',
  laptop: 'Portable (Wi-Fi)',
  server: 'Serveur',
  internet: 'Arrivée opérateur (FAI)',
  switch8: DEVICES.switch8.name,
  switch24: DEVICES.switch24.name,
  switch_l3: DEVICES.switch_l3.name,
  router: DEVICES.router.name,
  router_pro: DEVICES.router_pro.name,
  ap: DEVICES.ap.name,
};

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

function card(title: string, ...children: (Node | string | null | false | undefined)[]): HTMLElement {
  return h('section', { class: 'card' }, h('h3', { class: 'card-title' }, title), ...children);
}

function row(label: string, value: Node | string): HTMLElement[] {
  return [h('dt', null, label), h('dd', null, value)];
}

// ---------------------------------------------------------------------------
// Guide et conseils

export function guideCard(ctx: PanelCtx): Card | null {
  const steps = ctx.level.guide;
  if (steps && ctx.phase !== 'live') {
    const list = h('ol', { class: 'guide' });
    const update = () => {
      const s = ctx.guide;
      let current = false;
      list.replaceChildren(
        ...steps.map((st) => {
          const done = st.done(s);
          const isCurrent = !done && !current;
          if (isCurrent) current = true;
          return h('li', { class: done ? 'done' : isCurrent ? 'current' : '' }, st.text);
        }),
      );
    };
    update();
    return { el: card('Guide de démarrage', list), update };
  }
  if (ctx.phase === 'live' || !ctx.level.tips.length) return null;
  return { el: card('Conseils', h('ul', { class: 'tips' }, ...ctx.level.tips.map((t) => h('li', null, t)))) };
}

// ---------------------------------------------------------------------------
// Objectifs

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
        if (o.kind === 'survive') live = `frustration ${Math.round(sim.frustration)} %`;
        if (o.kind === 'noBreach') {
          live = `${sim.stats.breaches} brèche(s)`;
          state = sim.stats.breaches ? 'ko' : '';
        }
        if (o.kind === 'infected') {
          live = `${sim.stats.infectedTotal}/${o.max} infecté(s)`;
          state = sim.stats.infectedTotal > o.max ? 'ko' : '';
        }
        if (o.kind === 'service') {
          const total = sim.stats.poolTotal[o.pool] ?? 0;
          const okN = sim.stats.poolOk[o.pool] ?? 0;
          live = total ? `${Math.round((okN / total) * 100)} %` : '—';
        }
        if (o.kind === 'incidents') {
          const f = sim.incidents.filter((i) => i.kind === 'failure');
          live = f.length ? `${f.filter((i) => i.resolved !== undefined && !i.missed).length}/${f.length}` : 'aucune panne';
          state = f.some((i) => i.missed) ? 'ko' : '';
        }
      }
      items.push(h('li', { class: `obj ${state}` }, h('span', null, objectiveLabel(o, ctx.level)), live ? h('small', null, live) : null));
    }
    items.push(h('li', { class: 'obj-sep' }, 'Étoiles bonus'));
    for (const s of ctx.level.stars) {
      let live = '';
      let state: 'ok' | 'ko' | '' = '';
      if (s.kind === 'spent') {
        live = euros(spent);
        state = spent <= s.max ? 'ok' : 'ko';
      } else if (sim && s.kind === 'avgFrustration') {
        live = `${Math.round(sim.averageFrustration)} %`;
        state = sim.averageFrustration <= s.max ? 'ok' : 'ko';
      } else if (sim && s.kind === 'lossRate') {
        const r = sim.stats.transactions ? sim.stats.failed / sim.stats.transactions : 0;
        live = `${Math.round(r * 100)} %`;
        state = r <= s.max ? 'ok' : 'ko';
      } else if (sim && s.kind === 'mitigation') {
        const d = sim.incidents.filter((i) => i.kind === 'ddos');
        live = d.length ? d.map((i) => (i.resolved !== undefined ? `${Math.round(i.resolved - i.start)} s` : 'en cours')).join(', ') : 'pas encore';
      }
      items.push(h('li', { class: `obj star ${state}` }, h('span', null, `★ ${starLabel(s)}`), live ? h('small', null, live) : null));
    }
    list.replaceChildren(...items);
  };
  update();
  return { el: card('Objectifs', list), update };
}

// ---------------------------------------------------------------------------
// Diagnostic

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
    : h('p', { class: 'all-good' }, 'Aucun problème détecté : prêt pour la journée.');
  return { el: card(`Diagnostic${issues.length ? ` · ${issues.length}` : ''}`, body) };
}

// ---------------------------------------------------------------------------
// Inspecteur

function nodeTitle(n: NetNode): HTMLElement {
  return h('div', { class: 'insp-head' }, glyphIcon(n.kind), h('div', null, h('b', null, n.label), h('small', null, KIND_NAMES[n.kind])));
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
      ...row('Relie', `${a.label} ↔ ${b.label}`),
      ...row('Longueur', meters(l.length)),
      ...row('Débit', gbps(l.capacity)),
      ...(cable ? row('Coût', euros(cableCurrentCost(ctx.level, ctx.design, cable))) : []),
      h('dt', null, 'Utilisation'),
      util,
    );
    const update = () => {
      util.textContent = ctx.sim ? `${Math.round(ctx.sim.linkUtil(l.id) * 100)} %` : '— (journée non lancée)';
    };
    update();
    const title = l.kind === 'wifi' ? 'Liaison Wi-Fi' : CABLES[l.kind].name;
    return {
      el: card(
        'Sélection',
        h('div', { class: 'insp-head' }, h('div', null, h('b', null, title), h('small', null, l.broken ? 'Trop long : inactif' : 'Câble'))),
        dl,
        cable && ctx.phase !== 'live'
          ? h('div', { class: 'actions' }, h('button', { class: 'btn danger small', type: 'button', on: { click: () => ctx.removeLink(l.id) } }, 'Supprimer le câble'))
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
  props.push(...row('Pièce', room ? `${room.name}${room.kind === 'server' ? ' (climatisée)' : ''}` : 'Couloir'));
  if (n.group) props.push(...row('Groupe', groupName(ctx.level, n.group)));
  if (n.ports) props.push(...row('Ports', `${portsUsed(ctx.design, n.id)} / ${n.ports}`));
  if (n.transit) props.push(...row('Débit', gbps(n.capacity)));
  if (n.kind === 'server') props.push(...row('Capacité', `${n.capacity} requêtes/s`), ...row('Service', `${n.service!.proto.toUpperCase()}/${n.service!.port}`));
  if (n.kind === 'internet') props.push(...row('Abonnement', gbps(n.isp ?? 0)));
  if (n.wifi) props.push(...row('Wi-Fi', `${ctx.net.wifiClients.get(n.id)?.length ?? 0}/${n.wifi.clients} portables · portée ${meters(n.wifi.radius)}`));
  if (n.endpoint && n.kind !== 'internet') {
    const ip = addr.ipOf.get(n.id);
    props.push(...row('VLAN', String(addr.vlanOf.get(n.id) ?? '—')), ...row('Adresse IP', ip === undefined ? 'aucune' : formatIp(ip)));
  }
  if (n.kind === 'laptop' && ctx.net.uncovered.includes(n.id)) props.push(...row('Wi-Fi', 'hors couverture'));
  if (n.l3) props.push(...row('Rôle', n.nat ? 'Routage, pare-feu, NAT' : 'Routage inter-VLAN, pare-feu'));

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
    const state = st.down === 'failure' ? 'EN PANNE' : st.down === 'overheat' ? 'SURCHAUFFE' : st.quarantined ? 'EN QUARANTAINE' : st.infected ? 'INFECTÉ' : 'OK';
    rows.push(...row('État', h('span', { class: state === 'OK' ? 'ok' : 'crit' }, state)));
    if (n.transit || n.kind === 'server') {
      rows.push(...row('Charge', `${Math.round(Math.min(1, st.load) * 100)} %`), ...row('Température', `${tempCelsius(st.heat)} °C`), ...row('File', `${sim.queued(st)} paquet(s)`));
    }
    live.replaceChildren(...rows);
    if (n.l3 && hasFeature(ctx.level, 'firewall')) {
      const top = sim.topPorts().slice(0, 5);
      traffic.replaceChildren(
        h('p', { class: 'mini-title' }, 'Trafic observé (paquets/s)'),
        ...top.map((t) =>
          h(
            'div',
            { class: `traffic-row ${t.anomalous ? 'anomalous' : ''}` },
            h('code', null, `${t.anomalous ? '⚠ ' : ''}${t.key.toUpperCase()}`),
            h('span', null, String(t.pps)),
            t.key.endsWith('/443') || t.key.endsWith('/445')
              ? h('span', { class: 'muted' }, '—')
              : h('button', { class: 'btn ghost tiny', type: 'button', on: { click: () => ctx.run(`block ${t.key.replace('/', ' ')}`) } }, 'Bloquer'),
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
        btns.push(h('button', { class: 'btn primary small', type: 'button', on: { click: () => ctx.autoCable(n.id) } }, 'Câbler les postes proches'));
      }
      if (!n.fixed) {
        btns.push(
          h('button', { class: 'btn danger small', type: 'button', on: { click: () => ctx.removeNode(n.id) } }, `Supprimer (+${euros(DEVICES[n.kind as keyof typeof DEVICES].cost)})`),
        );
      }
    } else if (sim) {
      const st = sim.states.get(n.id);
      if (st?.down === 'failure' || (st && n.endpoint && (st.infected || st.quarantined))) {
        btns.push(h('button', { class: 'btn primary small', type: 'button', on: { click: () => ctx.run(`dispatch ${n.id}`) } }, 'Envoyer un technicien'));
      }
      if ((n.kind === 'workstation' || n.kind === 'laptop') && hasFeature(ctx.level, 'quarantine')) {
        btns.push(
          ctx.config.quarantine.includes(n.id)
            ? h('button', { class: 'btn ghost small', type: 'button', on: { click: () => ctx.run(`release ${n.id}`) } }, 'Sortir de quarantaine')
            : h('button', { class: 'btn danger small', type: 'button', on: { click: () => ctx.run(`quarantine ${n.id}`) } }, 'Isoler (quarantaine)'),
        );
      }
    }
    actions.replaceChildren(...btns);
  };
  update();
  rebuildActions();
  return {
    el: card('Sélection', nodeTitle(n), h('dl', { class: 'props' }, ...props), live, traffic, actions),
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
        h('p', { class: 'muted' }, 'Adressage automatique (DHCP) : chaque VLAN reçoit un /24 en 10.0.x.0. Rien à calculer ici.'),
      );
      return;
    }
    const rows = addr.vlans.map((v) => {
      const input = h('input', {
        class: 'cidr',
        id: `subnet-${v.vlan}`,
        type: 'text',
        value: ctx.config.subnets[String(v.vlan)] ?? '',
        placeholder: 'ex. 10.42.0.16/29',
        spellcheck: 'false',
        aria: { label: `Sous-réseau du VLAN ${v.vlan}` },
      });
      const status = h('span', { class: `status ${v.ok ? 'ok' : 'ko'}` }, v.ok ? `✔ ${v.hosts} hôte(s), ${Math.max(0, v.usable - 1 - v.hosts)} libre(s)` : `✖ ${v.error}${v.hint ? ` ${v.hint}` : ''}`);
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
      h('p', { class: 'mini-title' }, `Sous-réseaux · bloc attribué ${lvl.addressing.mode === 'manual' ? lvl.addressing.block : ''}`),
      ...rows,
      h('p', { class: 'cheat' }, `/27 = ${usableHosts(27)} hôtes · /28 = ${usableHosts(28)} · /29 = ${usableHosts(29)} · /30 = ${usableHosts(30)} (passerelle comprise)`),
    );
  };

  const groupRows = lvl.groups.map((g) => {
    const members = lvl.endpoints.filter((e) => e.group === g.id);
    const count = members.length;
    const unit = members.every((e) => e.kind === 'server') ? 'serveur' : 'poste';
    const input = h('input', {
      class: 'vlan',
      id: `vlan-${g.id}`,
      type: 'number',
      min: '1',
      max: '4094',
      value: String(ctx.config.vlans[g.id] ?? 1),
      disabled: !canVlan,
      aria: { label: `VLAN de ${g.name}` },
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
      h('label', { for: `vlan-${g.id}` }, h('i', { class: 'swatch', style: `--c:${g.color}` }), g.name, h('small', null, `${count} ${unit}${count > 1 ? 's' : ''}`)),
      input,
    );
  });
  renderSubnets();
  const auto = ctx.skills.has('autovlan') && canVlan
    ? h('button', { class: 'btn ghost small', type: 'button', on: { click: () => ctx.run('autovlan') } }, 'Script Auto-VLAN & IPAM')
    : null;
  return h(
    'div',
    { class: 'cfg-section' },
    h('p', { class: 'mini-title' }, canVlan ? 'VLAN par groupe' : 'VLAN (disponible plus tard dans la campagne)'),
    ...groupRows,
    auto,
    subnetsBox,
  );
}

function selectorOptions(ctx: PanelCtx): { value: string; label: string }[] {
  const lvl = ctx.level;
  const opts = [
    { value: 'any', label: 'Tout' },
    { value: 'internet', label: 'Internet' },
  ];
  for (const g of lvl.groups) opts.push({ value: g.id, label: `Groupe · ${g.name}` });
  for (const pool of [...new Set(lvl.endpoints.filter((e) => e.pool).map((e) => e.pool!))]) opts.push({ value: pool, label: `Service · ${pool.toUpperCase()}` });
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
            i > 0 ? h('button', { class: 'icon-btn', type: 'button', title: 'Monter', aria: { label: 'Monter la règle' }, on: { click: () => ctx.run(`fw up ${i + 1}`) } }, '↑') : null,
            h('button', { class: 'icon-btn', type: 'button', title: 'Supprimer', aria: { label: 'Supprimer la règle' }, on: { click: () => ctx.run(`fw del ${i + 1}`) } }, '✕'),
          ),
        ),
      )
    : h('p', { class: 'muted' }, 'Aucune règle : tout le trafic routé passe.');
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
  const action = h('select', { id: 'fw-action', aria: { label: 'Action' } }, h('option', { value: 'deny' }, 'Bloquer'), h('option', { value: 'allow' }, 'Autoriser'));
  const src = sel('fw-src', 'Source', 'any');
  const dst = sel('fw-dst', 'Destination', 'any');
  const svc = h('input', { id: 'fw-svc', type: 'text', placeholder: 'tcp/445 (vide = tout)', spellcheck: 'false', aria: { label: 'Service' } });
  const add = h('form', { class: 'rule-form' }, action, src, h('span', { class: 'arrow' }, '→'), dst, svc, h('button', { class: 'btn primary small', type: 'submit' }, 'Ajouter'));
  add.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = svc.value.trim();
    if (s && !parseService(s)) {
      svc.setCustomValidity('Exemples : tcp/445, udp/123, 443');
      svc.reportValidity();
      return;
    }
    svc.setCustomValidity('');
    ctx.run(`fw ${action.value} ${src.value} ${dst.value}${s ? ` ${s}` : ''}`);
  });
  const quick = h('form', { class: 'quick-block' });
  const proto = h('select', { id: 'qb-proto', aria: { label: 'Protocole' } }, h('option', { value: 'udp' }, 'UDP'), h('option', { value: 'tcp' }, 'TCP'));
  const port = h('input', { id: 'qb-port', type: 'number', min: '1', max: '65535', placeholder: 'port', aria: { label: 'Port' } });
  const range = h('input', { id: 'qb-range', type: 'text', placeholder: 'plage, ex. 185.220.0.0/16', spellcheck: 'false', aria: { label: 'Plage d’adresses' } });
  quick.append(
    h('span', { class: 'mini-title' }, 'Bloquer vite'),
    proto,
    port,
    h('button', { class: 'btn danger small', type: 'submit' }, 'Port'),
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
      'Plage',
    ),
  );
  quick.addEventListener('submit', (e) => {
    e.preventDefault();
    if (port.value) ctx.run(`block ${proto.value} ${port.value}`);
  });
  return h(
    'div',
    { class: 'cfg-section' },
    h('p', { class: 'mini-title' }, 'Pare-feu'),
    h('p', { class: 'hint-line' }, 'Filtre le trafic routé (entre VLAN ou vers Internet). La première règle qui correspond s’applique.'),
    list,
    compact ? null : add,
    quick,
  );
}

function lbSection(ctx: PanelCtx): HTMLElement | null {
  const pools = [...new Set(ctx.level.endpoints.filter((e) => e.pool).map((e) => e.pool!))];
  const multi = pools.filter((p) => ctx.level.endpoints.filter((e) => e.pool === p).length > 1);
  if (!multi.length) return null;
  const names: Record<LbMode, string> = { none: 'Aucune (tout au premier serveur)', rr: 'Round-robin', least: 'Moins de connexions' };
  return h(
    'div',
    { class: 'cfg-section' },
    h('p', { class: 'mini-title' }, 'Répartition de charge'),
    ...multi.map((p) => {
      const n = ctx.level.endpoints.filter((e) => e.pool === p).length;
      const select = h(
        'select',
        { id: `lb-${p}`, aria: { label: `Répartition du pool ${p}` } },
        ...(['none', 'rr', 'least'] as LbMode[]).map((m) => {
          const locked = m === 'least' && !ctx.skills.has('lb_least');
          const opt = h('option', { value: m, disabled: locked }, `${names[m]}${locked ? ' (compétence)' : ''}`);
          if ((ctx.config.lb[p] ?? 'none') === m) opt.selected = true;
          return opt;
        }),
      );
      select.addEventListener('change', () => ctx.run(`lb ${p} ${select.value}`));
      return h('div', { class: 'vlan-row' }, h('label', { for: `lb-${p}` }, p.toUpperCase(), h('small', null, `${n} serveurs`)), select);
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
        h('p', null, 'Adressage automatique (DHCP) et aucune règle de sécurité exigée dans cette mission.'),
        h('p', { class: 'muted' }, 'Teste quand même ton réseau depuis la console : ', h('code', null, 'ping pc-1 internet'), ' ou ', h('code', null, 'traceroute pc-1 nas'), '.'),
      ),
    );
  }
  return { el: card('Configuration', ...parts) };
}

export function liveFirewallCard(ctx: PanelCtx): Card | null {
  if (!hasFeature(ctx.level, 'firewall')) return null;
  return { el: card('Pare-feu en direct', firewallSection(ctx, true), lbSection(ctx)) };
}

// ---------------------------------------------------------------------------
// Alertes en direct

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
        : [h('li', { class: 'calm' }, 'Tout est calme… pour l’instant.')]),
    );
  };
  update();
  return { el: card('Alertes', list), update };
}

// ---------------------------------------------------------------------------
// Pied de panneau : action principale de la phase

export function phaseFooter(ctx: PanelCtx): HTMLElement {
  if (ctx.phase === 'live') {
    return h('div', { class: 'side-foot' }, h('button', { class: 'btn danger', type: 'button', on: { click: () => ctx.stop() } }, '■ Arrêter la journée'));
  }
  const cost = designCost(ctx.level, ctx.design);
  const over = cost > ctx.level.budget;
  return h(
    'div',
    { class: 'side-foot' },
    ctx.phase === 'build'
      ? h('button', { class: 'btn ghost', type: 'button', on: { click: () => ctx.goPhase('config') } }, 'Configuration →')
      : h('button', { class: 'btn ghost', type: 'button', on: { click: () => ctx.goPhase('build') } }, '← Architecture'),
    h('button', { class: 'btn primary', type: 'button', disabled: over, title: over ? 'Budget dépassé' : '', on: { click: () => ctx.launch() } }, 'Lancer la journée ▶'),
  );
}
