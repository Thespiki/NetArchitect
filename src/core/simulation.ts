// Real-time simulation of a working day: packets, queues, heat, user frustration,
// attacks, failures and technicians.
// Fixed step (STEP) and fixed seed: the same design and the same player actions replay
// exactly the same day. The server relies on this to verify leaderboard scores.

import { loc, T } from '../i18n/index.ts';
import { HEAT, TRAFFIC, tempCelsius } from './catalog.ts';
import { dist, exp } from './detmath.ts';
import {
  cloneConfig,
  compileRules,
  computeAddressing,
  firstMatch,
  matchContext,
  type Addressing,
  type CompiledRule,
  type MatchContext,
  type NetConfig,
  type PacketHeader,
} from './config.ts';
import { blockSize, formatCidr, formatIp, parseCidr, type Cidr } from './ip.ts';
import { clockLabel, groupName, type EventDef, type LevelDef } from './level.ts';
import { otherEnd, type NetLink, type NetNode, type Network } from './network.ts';
import { Rng } from './rng.ts';
import { Routing } from './routing.ts';
import type { Proto, SkillId, TrafficKind, Vec } from './types.ts';

export const STEP = 1 / 60;

export const FRUSTRATION = {
  /** Rise per second when every transaction fails. */
  gain: 8,
  /** Drop per second when everything goes well. */
  relief: 1.5,
  /** Memory (s) of recent transactions. */
  tau: 5,
  /** Dampens small volumes (start of the day). */
  damping: 3,
  lateWait: 0.8,
  badWait: 2.5,
  missedIncident: 15,
};

const TECH_SPEED = 3.5;
const REPAIR_TIME = 4;
const CLEAN_TIME = 6;

export type DropReason = 'overflow' | 'blocked' | 'noroute' | 'down' | 'ratelimit';
export type SpawnError = 'down' | 'noip' | 'noroute' | 'isolated';
export type Quality = 'good' | 'late' | 'bad';

export interface Flow {
  id: number;
  kind: TrafficKind;
  /** Group of the requester, or "clients" for inbound e-commerce traffic. */
  group: string;
  pool?: string;
  done: boolean;
}

export interface Packet {
  id: number;
  kind: TrafficKind;
  src: string;
  dst: string;
  origin: string;
  srcIp: number;
  dstIp: number;
  proto: Proto;
  port: number;
  size: number;
  routed: boolean;
  response: boolean;
  flow: Flow | null;
  waited: number;
  enq: number;
  node: string | null;
  link: NetLink | null;
  from: string;
  progress: number;
  dead: boolean;
}

export interface NodeState {
  node: NetNode;
  up: boolean;
  down: 'overheat' | 'failure' | null;
  ingress: Packet[];
  egress: Map<string, Packet[]>;
  tokens: number;
  processed: number;
  load: number;
  heat: number;
  warned: boolean;
  infected: boolean;
  /** Reinstalled and patched by a technician: immune to the worm. */
  patched: boolean;
  quarantined: boolean;
  lastEffect: number;
}

export interface LinkState {
  link: NetLink;
  tokens: [number, number];
  sent: [number, number];
  util: [number, number];
}

export interface Technician {
  id: number;
  x: number;
  y: number;
  home: Vec;
  state: 'idle' | 'moving' | 'working' | 'returning';
  target: string | null;
  job: 'repair' | 'clean' | null;
  path: Vec[];
  work: number;
  workTotal: number;
}

export interface Incident {
  id: number;
  kind: 'failure' | 'ddos' | 'worm';
  label: string;
  target?: string;
  start: number;
  end?: number;
  deadline?: number;
  resolved?: number;
  missed: boolean;
  passed: number;
  blocked: number;
  autoDone: boolean;
  event?: EventDef;
}

export interface LogEntry {
  t: number;
  level: 'info' | 'ok' | 'warn' | 'crit';
  text: string;
  action?: { label: string; cmd: string };
}

export type EffectKind = 'drop' | 'blocked' | 'breach' | 'unreach' | 'infect' | 'fixed' | 'overheat' | 'failure';

export interface Effect {
  kind: EffectKind;
  t: number;
  node?: string;
  link?: NetLink;
  from?: string;
  progress?: number;
}

export interface Stats {
  transactions: number;
  good: number;
  late: number;
  failed: number;
  drops: Record<DropReason, number>;
  unreachable: number;
  blockedLegit: number;
  breaches: number;
  probes: number;
  probesBlocked: number;
  attackPackets: number;
  attackBlocked: number;
  infectedTotal: number;
  overheats: number;
  peakFrustration: number;
  frustrationSum: number;
  poolOk: Record<string, number>;
  poolTotal: Record<string, number>;
}

export interface Observed {
  t: number;
  kind: TrafficKind;
  src: string;
  dst: string;
  srcIp: number;
  dstIp: number;
  proto: Proto;
  port: number;
}

/** Observed rate of a port or a source: recent (≈ 3 s) and baseline (≈ 30 s). */
interface Rate {
  count: number;
  fast: number;
  slow: number;
  dsts: Map<string, number>;
  lastDsts: Map<string, number>;
}

export interface TopEntry {
  key: string;
  label: string;
  pps: number;
  dsts: string[];
  anomalous: boolean;
}

/** A player action during the day, recorded with the step at which it happened. */
export type SimAction = { tick: number; kind: 'config'; config: NetConfig } | { tick: number; kind: 'dispatch'; id: string };

export interface SimOptions {
  skills?: ReadonlySet<SkillId>;
  seed?: number;
}

const OFFICE_CURVE: [number, number][] = [
  [0, 0.35],
  [0.083, 0.9],
  [0.28, 1],
  [0.36, 0.72],
  [0.5, 0.65],
  [0.58, 1],
  [0.83, 0.95],
  [0.94, 0.6],
  [1, 0.4],
];

const SHOP_CURVE: [number, number][] = [
  [0, 0.45],
  [0.25, 0.8],
  [0.4, 0.75],
  [0.6, 0.9],
  [0.85, 1],
  [1, 0.9],
];

function interp(points: [number, number][], f: number): number {
  if (f <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (f <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (f - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

export function officeCurve(f: number): number {
  return interp(OFFICE_CURVE, f);
}

const CUSTOMER_RANGES = [
  '82.64.0.0/16',
  '90.12.0.0/16',
  '176.31.0.0/16',
  '2.14.0.0/16',
  '78.192.0.0/16',
  '109.8.0.0/16',
  '92.184.0.0/16',
  '86.246.0.0/16',
  '37.165.0.0/16',
  '88.160.0.0/16',
].map((c) => parseCidr(c)!);

const SITE_RANGES = ['142.250.0.0/16', '151.101.0.0/16', '104.16.0.0/16', '13.32.0.0/16', '23.52.0.0/16'].map(
  (c) => parseCidr(c)!,
);

export class Simulation {
  readonly level: LevelDef;
  readonly net: Network;
  readonly dayLength: number;
  readonly routing: Routing;
  readonly skills: ReadonlySet<SkillId>;

  config: NetConfig;
  addr: Addressing;
  private rules: CompiledRule[] = [];
  private mctx: MatchContext;
  private readonly rng: Rng;

  t = 0;
  /** Steps simulated so far. */
  ticks = 0;
  frustration = 0;
  finished = false;
  failed = false;
  failReason = '';
  configVersion = 0;
  logVersion = 0;

  readonly packets: Packet[] = [];
  readonly states = new Map<string, NodeState>();
  readonly linkStates = new Map<string, LinkState>();
  readonly effects: Effect[] = [];
  readonly log: LogEntry[] = [];
  readonly incidents: Incident[] = [];
  readonly techs: Technician[] = [];
  readonly history: number[] = [];
  readonly ruleHits = new Map<number, number>();
  readonly stats: Stats;
  /** Configuration at the start of the day. */
  readonly initialConfig: NetConfig;
  /** Player actions in order: enough to replay the whole day. */
  readonly actions: SimAction[] = [];

  private readonly users: NodeState[] = [];
  private readonly processors: NodeState[] = [];
  private readonly pools = new Map<string, NodeState[]>();
  private readonly internalTargets: string[] = [];
  private readonly internetId: string | null;
  private readonly firedEvents = new Set<EventDef>();
  private readonly peaks: { ev: Extract<EventDef, { kind: 'peak' }>; start: number }[] = [];
  private readonly audits: { from: string[]; to: string[]; rate: number }[] = [];
  private readonly timers: { at: number; fn: () => void }[] = [];
  private readonly rr = new Map<string, number>();
  private readonly rateTokens = new Map<number, number>();
  private readonly throttle = new Map<string, number>();
  private readonly mood = new Map<string, { good: number; bad: number }>();
  private worm: { rate: number; chance: number } | null = null;
  private readonly everInfected = new Set<string>();
  private good = 0;
  private bad = 0;
  private flowSeq = 0;
  private packetSeq = 0;
  private incidentSeq = 0;
  private effectBudget = 0;
  private second = 0;
  private readonly portRates = new Map<string, Rate>();
  private readonly srcRates = new Map<string, Rate>();
  private readonly recent: Observed[] = [];

  constructor(level: LevelDef, net: Network, config: NetConfig, opts: SimOptions = {}) {
    this.level = level;
    this.net = net;
    this.dayLength = level.dayLength;
    this.skills = opts.skills ?? new Set();
    this.rng = new Rng(opts.seed ?? level.seed);
    this.config = config;
    this.initialConfig = cloneConfig(config);
    this.addr = computeAddressing(level, config);
    this.mctx = matchContext(level, this.addr);
    this.rules = compileRules(level, config.rules);
    this.stats = {
      transactions: 0,
      good: 0,
      late: 0,
      failed: 0,
      drops: { overflow: 0, blocked: 0, noroute: 0, down: 0, ratelimit: 0 },
      unreachable: 0,
      blockedLegit: 0,
      breaches: 0,
      probes: 0,
      probesBlocked: 0,
      attackPackets: 0,
      attackBlocked: 0,
      infectedTotal: 0,
      overheats: 0,
      peakFrustration: 0,
      frustrationSum: 0,
      poolOk: {},
      poolTotal: {},
    };

    const quarantined = new Set(config.quarantine);
    for (const node of net.nodes) {
      const s: NodeState = {
        node,
        up: true,
        down: null,
        ingress: [],
        egress: new Map(),
        tokens: 0,
        processed: 0,
        load: 0,
        heat: 0,
        warned: false,
        infected: false,
        patched: false,
        quarantined: quarantined.has(node.id),
        lastEffect: -10,
      };
      this.states.set(node.id, s);
      if (node.kind === 'workstation' || node.kind === 'laptop') this.users.push(s);
      if (node.transit || node.kind === 'server') this.processors.push(s);
      if (node.kind === 'server' && node.pool) {
        const list = this.pools.get(node.pool) ?? [];
        list.push(s);
        this.pools.set(node.pool, list);
      }
      if (node.endpoint && node.kind !== 'internet') this.internalTargets.push(node.id);
    }
    for (const link of net.links) {
      this.linkStates.set(link.id, { link, tokens: [0, 0], sent: [0, 0], util: [0, 0] });
    }
    this.internetId = net.nodes.find((n) => n.kind === 'internet')?.id ?? null;
    this.routing = new Routing(net, (id) => this.isUp(id));

    for (const a of level.audits ?? []) {
      const from = level.endpoints.filter((e) => e.group === a.from && e.kind !== 'internet').map((e) => e.id);
      const to = level.endpoints
        .filter((e) => e.kind !== 'internet' && (e.pool === a.to || e.group === a.to || e.id === a.to))
        .map((e) => e.id);
      if (from.length && to.length) this.audits.push({ from, to, rate: a.rate });
    }

    const techCount = this.skills.has('tech2') ? 2 : 1;
    for (let i = 0; i < techCount; i++) {
      const home = { x: level.techBase.x + 0.5 + i * 0.8, y: level.techBase.y + 0.5 };
      this.techs.push({ id: i + 1, x: home.x, y: home.y, home, state: 'idle', target: null, job: null, path: [], work: 0, workTotal: 0 });
    }

    this.pushLog('info', T.sim.dayStart(level.company));
  }

  // -------------------------------------------------------------------------
  // Accessors

  get fraction(): number {
    return Math.min(1, this.t / this.dayLength);
  }

  get clock(): string {
    return clockLabel(this.fraction);
  }

  clockAt(t: number): string {
    return clockLabel(t / this.dayLength);
  }

  get averageFrustration(): number {
    return this.t > 0 ? this.stats.frustrationSum / this.t : 0;
  }

  isUp(id: string): boolean {
    const s = this.states.get(id);
    return !!s && s.up && !s.quarantined;
  }

  moodOf(group: string): number {
    const m = this.mood.get(group);
    if (!m) return 0;
    return m.bad / (m.good + m.bad + 1);
  }

  linkUtil(id: string): number {
    const ls = this.linkStates.get(id);
    return ls ? Math.min(1, Math.max(ls.util[0], ls.util[1])) : 0;
  }

  queued(s: NodeState): number {
    let n = s.ingress.length;
    for (const q of s.egress.values()) n += q.length;
    return n;
  }

  activeInfected(): NodeState[] {
    return [...this.states.values()].filter((s) => s.infected && !s.quarantined);
  }

  // -------------------------------------------------------------------------
  // Loop

  step(dt = STEP): void {
    if (this.finished) return;
    this.ticks++;
    this.t += dt;
    this.effectBudget = 8;
    const sec = Math.floor(this.t);
    if (sec !== this.second) {
      this.second = sec;
      this.rollRates(this.portRates);
      this.rollRates(this.srcRates);
      this.history.push(Math.round(this.frustration * 10) / 10);
    }
    this.fireEvents();
    this.runTimers();
    this.refillRateLimits(dt);
    this.generate(dt);
    this.processNodes(dt);
    this.sendEgress(dt);
    this.moveOnLinks(dt);
    this.updateThermal(dt);
    this.updateIncidents(dt);
    this.updateTechs(dt);
    this.updateFrustration(dt);
    this.compact();

    if (this.frustration >= 100) {
      this.frustration = 100;
      this.failed = true;
      this.finished = true;
      this.failReason = T.sim.failReason;
      this.pushLog('crit', T.sim.riot);
    } else if (this.t >= this.dayLength) {
      this.finished = true;
      this.pushLog('ok', T.sim.dayEnd);
    }
  }

  // -------------------------------------------------------------------------
  // Traffic generation

  private peakFactor(target: 'all' | 'customers' | 'stream'): number {
    let f = 1;
    for (const p of this.peaks) {
      if (p.ev.target === target && this.t >= p.start && this.t <= p.start + p.ev.duration) f *= p.ev.factor;
    }
    return f;
  }

  private generate(dt: number): void {
    const f = this.fraction;
    const userFactor = officeCurve(f) * this.peakFactor('all');
    const streamBoost = (f > 0.33 && f < 0.5 ? 2.2 : 1) * this.peakFactor('stream');

    for (const s of this.users) {
      const gt = this.level.traffic.groups[s.node.group ?? ''];
      if (!gt) continue;
      if (this.rng.next() >= gt.rate * userFactor * dt) continue;
      const kind = this.rng.weighted<'web' | 'stream' | 'data'>({
        web: gt.mix.web ?? 0,
        stream: (gt.mix.stream ?? 0) * streamBoost,
        data: gt.data?.length ? (gt.mix.data ?? 0) : 0,
      });
      if (!kind) continue;
      if (kind === 'data') {
        const pool = this.rng.pick(gt.data!);
        const srv = this.pickServer(pool);
        this.request(kind, s.node.id, srv?.node.id ?? null, s.node.group ?? '', pool, pool);
      } else {
        this.request(kind, s.node.id, this.internetId, s.node.group ?? '', undefined, T.sim.internet);
      }
    }

    const cust = this.level.traffic.customers;
    if (cust && this.internetId) {
      const curve = this.level.traffic.curve === 'shop' ? interp(SHOP_CURVE, f) : officeCurve(f);
      const n = this.arrivals(cust.rate * curve * this.peakFactor('customers') * dt);
      for (let i = 0; i < n; i++) {
        const srv = this.pickServer(cust.pool);
        const flow = this.newFlow('customer', 'clients', cust.pool);
        const err = srv
          ? this.spawn({
              kind: 'customer',
              src: this.internetId,
              dst: srv.node.id,
              origin: this.internetId,
              flow,
              srcIp: this.randomIn(this.rng.pick(CUSTOMER_RANGES)),
            })
          : 'down';
        if (err) {
          this.unreachable(flow, this.internetId, err, T.sim.customers, cust.pool);
        }
      }
    }

    for (const a of this.audits) {
      if (this.rng.next() >= a.rate * dt) continue;
      const src = this.rng.pick(a.from);
      const dst = this.rng.pick(a.to);
      const svc = this.states.get(dst)!.node.service ?? { proto: 'tcp' as Proto, port: 445 };
      this.stats.probes++;
      const err = this.spawn({ kind: 'probe', src, dst, origin: src, flow: null, proto: svc.proto, port: svc.port });
      if (err) {
        this.stats.probesBlocked++;
        this.effectAt('blocked', src);
      }
    }

    for (const inc of this.incidents) {
      if (inc.kind !== 'ddos' || inc.end !== undefined || !this.internetId) continue;
      const ev = inc.event as Extract<EventDef, { kind: 'ddos' }>;
      const elapsed = this.t - inc.start;
      if (elapsed > ev.duration) {
        inc.end = this.t;
        if (inc.resolved === undefined) this.pushLog('warn', T.sim.attackFaded(loc(ev.name)));
        continue;
      }
      const sources = parseCidr(ev.sources)!;
      const n = this.arrivals(ev.rate * Math.min(1, elapsed / ev.ramp) * dt);
      for (let i = 0; i < n; i++) {
        const target = this.pools.has(ev.target) ? this.pickServer(ev.target)?.node.id : ev.target;
        if (!target) break;
        this.stats.attackPackets++;
        this.spawn({
          kind: 'attack',
          src: this.internetId,
          dst: target,
          origin: this.internetId,
          flow: null,
          srcIp: this.randomIn(sources),
          proto: ev.proto,
          port: ev.port,
        });
      }
    }

    if (this.worm) {
      for (const s of this.users) {
        if (!s.infected || s.quarantined || !s.up) continue;
        if (this.rng.next() >= this.worm.rate * dt) continue;
        const dst = this.rng.pick(this.internalTargets);
        if (dst === s.node.id) continue;
        this.spawn({ kind: 'worm', src: s.node.id, dst, origin: s.node.id, flow: null });
      }
    }
  }

  /** Number of arrivals during one step for a given expectation. */
  private arrivals(expected: number): number {
    const n = Math.floor(expected);
    return n + (this.rng.next() < expected - n ? 1 : 0);
  }

  private randomIn(c: Cidr): number {
    return (c.base + 1 + this.rng.int(Math.max(1, blockSize(c.prefix) - 2))) >>> 0;
  }

  pickServer(pool: string): NodeState | null {
    const servers = this.pools.get(pool) ?? [];
    if (!servers.length) return null;
    const mode = this.config.lb[pool] ?? 'none';
    const effective = mode === 'least' && !this.skills.has('lb_least') ? 'rr' : mode;
    if (effective === 'none') return servers[0];
    const healthy = servers.filter((s) => this.isUp(s.node.id) && this.addr.ipOf.has(s.node.id));
    if (!healthy.length) return servers[0];
    if (effective === 'rr') {
      const i = this.rr.get(pool) ?? 0;
      this.rr.set(pool, i + 1);
      return healthy[i % healthy.length];
    }
    let best = healthy[0];
    let score = Infinity;
    for (const s of healthy) {
      const sc = (s.ingress.length + 1) / s.node.capacity;
      if (sc < score) {
        score = sc;
        best = s;
      }
    }
    return best;
  }

  private newFlow(kind: TrafficKind, group: string, pool?: string): Flow {
    this.stats.transactions++;
    return { id: ++this.flowSeq, kind, group, pool, done: false };
  }

  private request(
    kind: 'web' | 'stream' | 'data',
    src: string,
    dst: string | null,
    group: string,
    pool: string | undefined,
    destLabel: string,
  ): void {
    const flow = this.newFlow(kind, group, pool);
    let err: SpawnError | null = 'down';
    if (dst) {
      const dstIp = dst === this.internetId ? this.randomIn(this.rng.pick(SITE_RANGES)) : undefined;
      const svc = this.states.get(dst)?.node.service;
      err = this.spawn({ kind, src, dst, origin: src, flow, dstIp, proto: svc?.proto, port: svc?.port });
    }
    if (err) {
      const who = err === 'isolated' ? (this.states.get(src)?.node.label ?? src) : groupName(this.level, group);
      this.unreachable(flow, src, err, who, destLabel);
    }
  }

  private unreachable(flow: Flow, at: string, reason: SpawnError, who: string, dest: string): void {
    this.stats.unreachable++;
    this.outcome(flow, 'bad');
    this.effectAt('unreach', at);
    const key = `${reason === 'isolated' ? 'q' : who}|${dest}|${reason}`;
    const last = this.throttle.get(key) ?? -Infinity;
    if (this.t - last < 12) return;
    this.throttle.set(key, this.t);
    const msg =
      reason === 'noip'
        ? T.sim.noIp(who)
        : reason === 'noroute'
          ? T.sim.noRoute(who, dest)
          : reason === 'isolated'
            ? T.sim.isolated
            : T.sim.destDown(who, dest);
    this.pushLog('warn', msg);
  }

  /** Creates a packet at its source. Returns null when it left, otherwise why it failed. */
  private spawn(o: {
    kind: TrafficKind;
    src: string;
    dst: string;
    origin: string;
    flow: Flow | null;
    response?: boolean;
    srcIp?: number;
    dstIp?: number;
    proto?: Proto;
    port?: number;
    size?: number;
    waited?: number;
  }): SpawnError | null {
    const s = this.states.get(o.src);
    if (!s || !this.states.has(o.dst)) return 'noroute';
    if (s.quarantined) return 'isolated';
    if (!this.isUp(o.src) || !this.isUp(o.dst)) return 'down';
    const srcIp = o.srcIp ?? this.addr.ipOf.get(o.src);
    const dstIp = o.dstIp ?? this.addr.ipOf.get(o.dst);
    if (srcIp === undefined || dstIp === undefined) return 'noip';
    const routed = this.addr.vlanOf.get(o.src) === this.addr.vlanOf.get(o.dst);
    const hops = this.routing.nextHops(o.src, o.dst, routed);
    if (hops.length === 0) return 'noroute';
    const spec = TRAFFIC[o.kind];
    const p: Packet = {
      id: ++this.packetSeq,
      kind: o.kind,
      src: o.src,
      dst: o.dst,
      origin: o.origin,
      srcIp,
      dstIp,
      proto: o.proto ?? spec.proto,
      port: o.port ?? spec.port,
      size: o.size ?? spec.reqSize,
      routed,
      response: !!o.response,
      flow: o.flow,
      waited: o.waited ?? 0,
      enq: this.t,
      node: o.src,
      link: null,
      from: o.src,
      progress: 0,
      dead: false,
    };
    this.packets.push(p);
    this.observe(p);
    this.enqueueEgress(s, this.pickLink(s, hops), p);
    return null;
  }

  private observe(p: Packet): void {
    if (p.response) return;
    const bump = (map: Map<string, Rate>, key: string) => {
      let r = map.get(key);
      if (!r) {
        r = { count: 0, fast: 0, slow: 0, dsts: new Map(), lastDsts: new Map() };
        map.set(key, r);
      }
      r.count++;
      r.dsts.set(p.dst, (r.dsts.get(p.dst) ?? 0) + 1);
    };
    bump(this.portRates, `${p.proto}/${p.port}`);
    bump(this.srcRates, p.src === this.internetId ? formatCidr({ base: (p.srcIp & 0xffff0000) >>> 0, prefix: 16 }) : p.src);
    this.recent.push({ t: this.t, kind: p.kind, src: p.src, dst: p.dst, srcIp: p.srcIp, dstIp: p.dstIp, proto: p.proto, port: p.port });
    if (this.recent.length > 60) this.recent.shift();
  }

  /** Every second: recent average and baseline (IDS-style anomaly detection). */
  private rollRates(map: Map<string, Rate>): void {
    const kFast = 1 - exp(-1 / 3);
    const kSlow = 1 - exp(-1 / 30);
    for (const r of map.values()) {
      r.fast += (r.count - r.fast) * kFast;
      r.slow = this.t < 12 ? r.fast : r.slow + (r.count - r.slow) * kSlow;
      r.count = 0;
      r.lastDsts = r.dsts;
      r.dsts = new Map();
    }
  }

  // -------------------------------------------------------------------------
  // Switching, routing and service

  private egressMax(n: NetNode): number {
    if (n.kind === 'internet') return 150;
    if (n.kind === 'server') return 40;
    if (n.endpoint) return 20;
    return Math.max(12, Math.round(n.queueMax / 2));
  }

  private enqueueEgress(s: NodeState, link: NetLink, p: Packet): void {
    let q = s.egress.get(link.id);
    if (!q) {
      q = [];
      s.egress.set(link.id, q);
    }
    if (q.length >= this.egressMax(s.node)) {
      this.drop(p, 'overflow', { node: s.node.id });
      return;
    }
    p.node = s.node.id;
    p.link = null;
    p.enq = this.t;
    q.push(p);
  }

  private pickLink(s: NodeState, hops: NetLink[]): NetLink {
    if (hops.length === 1) return hops[0];
    let best = hops[0];
    let score = Infinity;
    for (const l of hops) {
      const ls = this.linkStates.get(l.id)!;
      const dir = l.a === s.node.id ? 0 : 1;
      const sc = (s.egress.get(l.id)?.length ?? 0) + ls.util[dir] * 3;
      if (sc < score || (sc === score && l.id < best.id)) {
        score = sc;
        best = l;
      }
    }
    return best;
  }

  private processNodes(dt: number): void {
    for (const s of this.processors) {
      s.processed = 0;
      if (!s.up) continue;
      const n = s.node;
      s.tokens = Math.min(s.tokens + n.capacity * dt, n.capacity * 0.1 + 4);
      while (s.ingress.length) {
        const p = s.ingress[0];
        const cost = n.transit ? p.size : 1;
        if (s.tokens < cost) break;
        s.ingress.shift();
        p.waited += this.t - p.enq;
        const spent = n.transit ? this.forward(s, p) : this.serve(s, p);
        s.tokens -= spent;
        s.processed += spent;
      }
    }
  }

  private header(p: Packet): PacketHeader {
    return { src: p.src, dst: p.dst, srcIp: p.srcIp, dstIp: p.dstIp, proto: p.proto, port: p.port };
  }

  private forward(s: NodeState, p: Packet): number {
    const n = s.node;
    // A layer 3 device routes the packet when it changes VLAN (or leaves for the Internet): that is
    // where, and only where, the firewall applies. Traffic within a VLAN is simply switched.
    if (n.l3 && !p.routed) {
      // Stateful firewall: replies to established connections always pass.
      if (!p.response) {
        const rule = firstMatch(this.rules, this.header(p), this.mctx);
        if (rule) this.ruleHits.set(rule.rule.id, (this.ruleHits.get(rule.rule.id) ?? 0) + 1);
        if (rule && rule.rule.action === 'deny') {
          this.drop(p, 'blocked', { node: n.id });
          return p.size * 0.25;
        }
        if (this.rateLimited(p)) {
          this.drop(p, 'ratelimit', { node: n.id });
          return p.size * 0.25;
        }
      }
      if (p.kind === 'attack') this.noteAttack(false);
      p.routed = true;
    }
    const hops = this.routing.nextHops(n.id, p.dst, p.routed);
    if (hops.length === 0) {
      this.drop(p, 'noroute', { node: n.id });
      return p.size;
    }
    this.enqueueEgress(s, this.pickLink(s, hops), p);
    return p.size;
  }

  private serve(s: NodeState, p: Packet): number {
    if (p.kind === 'probe') this.breach(p, s.node);
    else if (p.kind !== 'attack' && p.kind !== 'worm') {
      const spec = TRAFFIC[p.kind];
      const err = this.spawn({
        kind: p.kind,
        src: s.node.id,
        dst: p.origin,
        origin: p.origin,
        flow: p.flow,
        response: true,
        dstIp: p.srcIp,
        proto: p.proto,
        port: p.port,
        size: spec.respSize,
        waited: p.waited,
      });
      if (err) this.failFlow(p.flow);
    }
    this.kill(p);
    return 1;
  }

  private rateLimited(p: Packet): boolean {
    for (const rl of this.config.rateLimits) {
      if (rl.proto !== p.proto || rl.port !== p.port) continue;
      const tokens = this.rateTokens.get(rl.id) ?? rl.pps * 0.5;
      if (tokens < 1) return true;
      this.rateTokens.set(rl.id, tokens - 1);
    }
    return false;
  }

  private refillRateLimits(dt: number): void {
    for (const rl of this.config.rateLimits) {
      const cur = this.rateTokens.get(rl.id) ?? rl.pps * 0.5;
      this.rateTokens.set(rl.id, Math.min(rl.pps * 0.5 + 1, cur + rl.pps * dt));
    }
  }

  private sendEgress(dt: number): void {
    for (const s of this.states.values()) {
      if (!s.up) continue;
      for (const [lid, q] of s.egress) {
        const ls = this.linkStates.get(lid)!;
        const dir = ls.link.a === s.node.id ? 0 : 1;
        const cap = ls.link.capacity;
        ls.tokens[dir] = Math.min(ls.tokens[dir] + cap * dt, cap * 0.1 + 4);
        if (!q.length) continue;
        if (!this.routing.linkUp(ls.link)) {
          for (const p of q.splice(0)) this.drop(p, 'down', { node: s.node.id });
          continue;
        }
        while (q.length && ls.tokens[dir] >= q[0].size) {
          const p = q.shift()!;
          ls.tokens[dir] -= p.size;
          ls.sent[dir] += p.size;
          p.waited += this.t - p.enq;
          p.node = null;
          p.link = ls.link;
          p.from = s.node.id;
          p.progress = 0;
        }
      }
    }
    const alpha = 1 - exp(-dt / 1.0);
    for (const ls of this.linkStates.values()) {
      for (const dir of [0, 1] as const) {
        const owner = dir === 0 ? ls.link.a : ls.link.b;
        const backlog = (this.states.get(owner)?.egress.get(ls.link.id)?.length ?? 0) > 2;
        const sent = ls.sent[dir] / (ls.link.capacity * dt);
        const inst = backlog ? Math.max(1, sent) : sent;
        ls.util[dir] = Math.min(1.2, ls.util[dir] + (inst - ls.util[dir]) * alpha);
        ls.sent[dir] = 0;
      }
    }
  }

  private moveOnLinks(dt: number): void {
    const n = this.packets.length;
    for (let i = 0; i < n; i++) {
      const p = this.packets[i];
      if (p.dead || !p.link) continue;
      const l = p.link;
      p.progress += (l.speed * dt) / l.length;
      if (p.progress >= 1) {
        const to = otherEnd(l, p.from);
        p.link = null;
        this.arrive(p, to);
      }
    }
  }

  private arrive(p: Packet, nodeId: string): void {
    const s = this.states.get(nodeId)!;
    if (p.dst === nodeId) {
      if (!this.isUp(nodeId)) this.drop(p, 'down', { node: nodeId });
      else this.deliver(p, s);
      return;
    }
    if (!s.up) return this.drop(p, 'down', { node: nodeId });
    if (!s.node.transit) return this.drop(p, 'noroute', { node: nodeId });
    if (s.ingress.length >= s.node.queueMax) return this.drop(p, 'overflow', { node: nodeId });
    p.node = nodeId;
    p.enq = this.t;
    s.ingress.push(p);
  }

  private deliver(p: Packet, s: NodeState): void {
    const n = s.node;
    if (n.kind === 'server') {
      if (s.ingress.length >= n.queueMax) return this.drop(p, 'overflow', { node: n.id });
      p.node = n.id;
      p.enq = this.t;
      s.ingress.push(p);
      return;
    }
    if (n.kind === 'internet') {
      if (p.response) this.complete(p);
      else if (p.kind === 'web' || p.kind === 'stream') {
        const q = p;
        this.later(0.2 + this.rng.next() * 0.25, () => {
          const err = this.spawn({
            kind: q.kind,
            src: n.id,
            dst: q.origin,
            origin: q.origin,
            flow: q.flow,
            response: true,
            srcIp: q.dstIp,
            proto: q.proto,
            port: q.port,
            size: TRAFFIC[q.kind].respSize,
            waited: q.waited,
          });
          if (err) this.failFlow(q.flow);
        });
      }
      this.kill(p);
      return;
    }
    if (p.response) this.complete(p);
    else if (p.kind === 'worm') this.wormHit(s);
    else if (p.kind === 'probe') this.breach(p, n);
    this.kill(p);
  }

  private later(delay: number, fn: () => void): void {
    this.timers.push({ at: this.t + delay, fn });
  }

  private runTimers(): void {
    if (!this.timers.length) return;
    const due = this.timers.filter((x) => x.at <= this.t);
    if (!due.length) return;
    const keep = this.timers.filter((x) => x.at > this.t);
    this.timers.length = 0;
    this.timers.push(...keep);
    for (const x of due) x.fn();
  }

  // -------------------------------------------------------------------------
  // Transaction outcomes

  private kill(p: Packet): void {
    p.dead = true;
    p.node = null;
    p.link = null;
  }

  private complete(p: Packet): void {
    if (!p.flow || p.flow.done) return;
    const q: Quality = p.waited > FRUSTRATION.badWait ? 'bad' : p.waited > FRUSTRATION.lateWait ? 'late' : 'good';
    this.outcome(p.flow, q);
  }

  private failFlow(flow: Flow | null): void {
    if (flow && !flow.done) this.outcome(flow, 'bad');
  }

  private outcome(flow: Flow, q: Quality): void {
    if (flow.done) return;
    flow.done = true;
    const w = q === 'good' ? 0 : q === 'late' ? 0.5 : 1;
    this.good += 1 - w;
    this.bad += w;
    let m = this.mood.get(flow.group);
    if (!m) {
      m = { good: 0, bad: 0 };
      this.mood.set(flow.group, m);
    }
    m.good += 1 - w;
    m.bad += w;
    if (q === 'good') this.stats.good++;
    else if (q === 'late') this.stats.late++;
    else this.stats.failed++;
    if (flow.pool) {
      this.stats.poolTotal[flow.pool] = (this.stats.poolTotal[flow.pool] ?? 0) + 1;
      if (q !== 'bad') this.stats.poolOk[flow.pool] = (this.stats.poolOk[flow.pool] ?? 0) + 1;
    }
  }

  private drop(p: Packet, reason: DropReason, where: { node?: string }): void {
    this.stats.drops[reason]++;
    const legit = TRAFFIC[p.kind].legit;
    if (legit) {
      if (reason === 'blocked') this.stats.blockedLegit++;
      this.failFlow(p.flow);
    }
    const stopped = reason === 'blocked' || reason === 'ratelimit';
    if (p.kind === 'probe' && (stopped || reason === 'noroute')) this.stats.probesBlocked++;
    if (p.kind === 'attack' && stopped) {
      this.stats.attackBlocked++;
      this.noteAttack(true);
    }
    const kind: EffectKind = stopped ? 'blocked' : 'drop';
    if (where.node) this.effectAt(kind, where.node, stopped ? 0.08 : 0.15);
    this.kill(p);
  }

  private effectAt(kind: EffectKind, node: string, minGap = 0): void {
    const important = kind !== 'drop' && kind !== 'blocked' && kind !== 'unreach';
    if (!important) {
      if (this.effectBudget <= 0) return;
      const s = this.states.get(node);
      if (s) {
        if (this.t - s.lastEffect < Math.max(minGap, kind === 'unreach' ? 1.2 : 0)) return;
        s.lastEffect = this.t;
      }
      this.effectBudget--;
    }
    this.effects.push({ kind, t: this.t, node });
  }

  private breach(p: Packet, target: NetNode): void {
    this.stats.breaches++;
    this.effectAt('breach', target.id);
    const src = this.states.get(p.src)?.node.label ?? p.src;
    const key = `breach|${p.src}|${target.id}`;
    const last = this.throttle.get(key) ?? -Infinity;
    if (this.t - last < 6) return;
    this.throttle.set(key, this.t);
    this.pushLog('crit', T.sim.breach(src, target.label, `${p.proto.toUpperCase()}/${p.port}`));
  }

  private wormHit(s: NodeState): void {
    if (!this.worm || s.infected || s.quarantined || s.patched) return;
    if (s.node.kind !== 'workstation' && s.node.kind !== 'laptop') return;
    if (!this.rng.chance(this.worm.chance)) return;
    this.infect(s);
  }

  private infect(s: NodeState): void {
    s.infected = true;
    this.everInfected.add(s.node.id);
    this.stats.infectedTotal = this.everInfected.size;
    this.effectAt('infect', s.node.id);
    const action = this.skills.has('ids') ? { label: T.sim.isolate(s.node.label), cmd: `quarantine ${s.node.id}` } : undefined;
    this.pushLog('warn', T.sim.infected(s.node.label), action);
  }

  private noteAttack(blocked: boolean): void {
    for (const inc of this.incidents) {
      if (inc.kind !== 'ddos' || inc.end !== undefined) continue;
      if (blocked) inc.blocked++;
      else inc.passed++;
    }
  }

  // -------------------------------------------------------------------------
  // Temperature and failures

  private updateThermal(dt: number): void {
    const alpha = 1 - exp(-dt / 1.2);
    const coolBoost = this.skills.has('cooling') ? HEAT.coolingSkill : 1;
    for (const s of this.processors) {
      const n = s.node;
      const inst = s.processed / (n.capacity * dt);
      const target = s.up ? (s.ingress.length > 3 ? Math.max(1, inst) : inst) : 0;
      s.load = Math.min(1.2, s.load + (target - s.load) * alpha);
      const l = Math.min(1, s.load);
      const gain = s.up ? HEAT.gain * n.heat * l * l : 0;
      s.heat = Math.max(0, s.heat + (gain - n.cooling * coolBoost * s.heat) * dt);
      if (s.up && s.heat >= HEAT.overheat) this.overheat(s);
      else if (s.down === 'overheat' && s.heat <= HEAT.restart) this.restart(s);
      if (s.up && !s.warned && s.heat >= 0.8) {
        s.warned = true;
        const where = n.roomKind === 'server' ? '' : T.sim.hotHint;
        this.pushLog('warn', `${T.sim.hot(n.label, tempCelsius(s.heat))}${where}`);
      } else if (s.warned && s.heat < 0.6) s.warned = false;
    }
  }

  private flush(s: NodeState): void {
    const all = [...s.ingress];
    for (const q of s.egress.values()) all.push(...q);
    s.ingress.length = 0;
    for (const q of s.egress.values()) q.length = 0;
    for (const p of all) if (!p.dead) this.drop(p, 'down', { node: s.node.id });
  }

  private overheat(s: NodeState): void {
    s.up = false;
    s.down = 'overheat';
    this.stats.overheats++;
    this.flush(s);
    this.routing.invalidate();
    this.effectAt('overheat', s.node.id);
    this.pushLog('crit', T.sim.overheat(s.node.label, tempCelsius(s.heat)));
  }

  private restart(s: NodeState): void {
    s.up = true;
    s.down = null;
    s.tokens = 0;
    this.routing.invalidate();
    this.pushLog('info', T.sim.restart(s.node.label));
  }

  // -------------------------------------------------------------------------
  // Scripted events and incidents

  private fireEvents(): void {
    for (const ev of this.level.events ?? []) {
      if (this.firedEvents.has(ev) || this.t < ev.at * this.dayLength) continue;
      this.firedEvents.add(ev);
      switch (ev.kind) {
        case 'peak':
          this.peaks.push({ ev, start: this.t });
          this.pushLog('warn', loc(ev.message));
          break;
        case 'failure':
          this.startFailure(ev);
          break;
        case 'ddos':
          this.startDdos(ev);
          break;
        case 'worm':
          this.startWorm(ev);
          break;
      }
    }
  }

  private newIncident(kind: Incident['kind'], label: string, extra: Partial<Incident> = {}): Incident {
    const inc: Incident = {
      id: ++this.incidentSeq,
      kind,
      label,
      start: this.t,
      missed: false,
      passed: 0,
      blocked: 0,
      autoDone: false,
      ...extra,
    };
    this.incidents.push(inc);
    return inc;
  }

  private startFailure(ev: Extract<EventDef, { kind: 'failure' }>): void {
    let target = ev.target === 'auto' ? this.autoFailureTarget() : this.states.get(ev.target);
    if (!target || !target.up) target = this.autoFailureTarget();
    if (!target) return;
    target.up = false;
    target.down = 'failure';
    this.flush(target);
    this.routing.invalidate();
    this.effectAt('failure', target.node.id);
    this.newIncident('failure', T.sim.failureLabel(target.node.label), { target: target.node.id, deadline: ev.deadline });
    this.pushLog('crit', T.sim.failure(target.node.label, ev.deadline), {
      label: T.sim.sendTech,
      cmd: `dispatch ${target.node.id}`,
    });
  }

  /** The access switch serving the most hosts (the most painful one). */
  private autoFailureTarget(): NodeState | undefined {
    let best: NodeState | undefined;
    let score = -1;
    for (const s of this.states.values()) {
      const n = s.node;
      if (!s.up || !n.transit) continue;
      const served = (this.net.adj.get(n.id) ?? []).filter((l) => this.net.byId.get(otherEnd(l, n.id))!.endpoint).length;
      const sc = (n.l3 ? 0 : 1000) + served * 10 + (n.kind === 'ap' ? 0 : 5);
      if (sc > score) {
        score = sc;
        best = s;
      }
    }
    return best;
  }

  private edgeLabel(): string {
    if (!this.internetId) return T.sim.theRouter;
    const l = (this.net.adj.get(this.internetId) ?? [])[0];
    return l ? this.net.byId.get(otherEnd(l, this.internetId))!.label : T.sim.theRouter;
  }

  private startDdos(ev: Extract<EventDef, { kind: 'ddos' }>): void {
    const name = loc(ev.name);
    this.newIncident('ddos', name, { event: ev, target: ev.target });
    const vector = `${ev.proto.toUpperCase()}/${ev.port}`;
    const byPort = !(ev.proto === 'tcp' && ev.port === 443);
    const cmd = byPort ? `block ${ev.proto} ${ev.port}` : `blockip ${ev.sources}`;
    const label = T.sim.block(byPort ? vector : ev.sources);
    if (this.skills.has('ids')) {
      this.pushLog('crit', T.sim.idsDdos(name, vector, ev.sources, ev.target.toUpperCase()), { label, cmd });
    } else {
      this.pushLog('crit', T.sim.ddos(this.edgeLabel()));
    }
  }

  private startWorm(ev: Extract<EventDef, { kind: 'worm' }>): void {
    const s = this.states.get(ev.patient);
    if (!s) return;
    this.worm = { rate: ev.rate, chance: ev.chance };
    this.newIncident('worm', T.sim.wormLabel);
    this.infect(s);
    if (this.skills.has('ids')) {
      this.pushLog('crit', T.sim.idsWorm(s.node.label), {
        label: T.sim.isolate(s.node.label),
        cmd: `quarantine ${s.node.id}`,
      });
    } else {
      this.later(6, () =>
        this.pushLog('crit', T.sim.worm),
      );
    }
  }

  private updateIncidents(dt: number): void {
    const decay = exp(-dt / 2);
    for (const inc of this.incidents) {
      if (inc.resolved !== undefined) continue;
      if (inc.kind === 'failure' && inc.deadline !== undefined && !inc.missed && this.t > inc.start + inc.deadline) {
        inc.missed = true;
        this.frustration = Math.min(100, this.frustration + FRUSTRATION.missedIncident);
        this.pushLog('crit', T.sim.deadlineMissed(inc.label, FRUSTRATION.missedIncident));
      }
      if (inc.kind === 'ddos' && inc.end === undefined) {
        inc.passed *= decay;
        inc.blocked *= decay;
        if (inc.blocked > 6 && inc.blocked / (inc.blocked + inc.passed) >= 0.9) {
          inc.resolved = this.t;
          this.pushLog('ok', T.sim.attackStopped(inc.label, Math.round(this.t - inc.start)));
        } else if (this.skills.has('autoblock') && !inc.autoDone && this.t - inc.start >= 6) {
          inc.autoDone = true;
          this.autoMitigate(inc);
        }
      }
      if (inc.kind === 'worm' && this.t - inc.start > 1 && this.activeInfected().length === 0) {
        inc.resolved = this.t;
        this.pushLog('ok', T.sim.wormContained(Math.round(this.t - inc.start)));
      }
    }
  }

  private autoMitigate(inc: Incident): void {
    const ev = inc.event as Extract<EventDef, { kind: 'ddos' }>;
    const byPort = !(ev.proto === 'tcp' && ev.port === 443);
    const rule = byPort
      ? { src: 'any', dst: 'any', proto: ev.proto, port: ev.port }
      : { src: ev.sources, dst: 'any', proto: 'any' as const, port: null };
    this.config.rules.unshift({ id: this.config.seq++, action: 'deny', ...rule });
    this.reconfigure(this.config);
    this.pushLog('ok', T.sim.autoMitigation(byPort ? `${ev.proto.toUpperCase()}/${ev.port}` : ev.sources));
  }

  // -------------------------------------------------------------------------
  // Technicians

  private updateTechs(dt: number): void {
    const speed = TECH_SPEED * (this.skills.has('tech_speed') ? 1.6 : 1);
    for (const tech of this.techs) {
      if (tech.state === 'moving' || tech.state === 'returning') {
        let budget = speed * dt;
        while (budget > 0 && tech.path.length) {
          const wp = tech.path[0];
          const dx = wp.x - tech.x;
          const dy = wp.y - tech.y;
          const d = dist(dx, dy);
          if (d <= budget) {
            tech.x = wp.x;
            tech.y = wp.y;
            budget -= d;
            tech.path.shift();
          } else {
            tech.x += (dx / d) * budget;
            tech.y += (dy / d) * budget;
            budget = 0;
          }
        }
        if (!tech.path.length) {
          if (tech.state === 'moving') {
            tech.state = 'working';
            tech.work = tech.workTotal;
          } else {
            tech.state = 'idle';
            tech.target = null;
            tech.job = null;
          }
        }
      } else if (tech.state === 'working') {
        tech.work -= dt;
        if (tech.work <= 0) this.finishJob(tech);
      }
    }
  }

  private finishJob(tech: Technician): void {
    const s = tech.target ? this.states.get(tech.target) : undefined;
    if (s && tech.job === 'repair' && s.down === 'failure') {
      s.up = true;
      s.down = null;
      s.heat = 0.2;
      s.tokens = 0;
      this.routing.invalidate();
      this.effectAt('fixed', s.node.id);
      for (const inc of this.incidents) {
        if (inc.kind === 'failure' && inc.target === s.node.id && inc.resolved === undefined) {
          inc.resolved = this.t;
          this.pushLog('ok', T.sim.repaired(s.node.label, Math.round(this.t - inc.start), inc.missed));
        }
      }
    } else if (s && tech.job === 'clean') {
      s.infected = false;
      s.patched = true;
      if (s.quarantined) {
        this.config.quarantine = this.config.quarantine.filter((id) => id !== s.node.id);
        this.reconfigure(this.config);
      }
      this.effectAt('fixed', s.node.id);
      this.pushLog('ok', T.sim.cleaned(s.node.label));
    }
    tech.state = 'returning';
    tech.job = null;
    tech.target = null;
    tech.path = this.manhattan(tech, tech.home);
  }

  private manhattan(from: Vec, to: Vec): Vec[] {
    return [
      { x: to.x, y: from.y },
      { x: to.x, y: to.y },
    ];
  }

  // -------------------------------------------------------------------------
  // Frustration

  private updateFrustration(dt: number): void {
    const decay = exp(-dt / FRUSTRATION.tau);
    this.good *= decay;
    this.bad *= decay;
    for (const m of this.mood.values()) {
      m.good *= decay;
      m.bad *= decay;
    }
    const ratio = this.bad / (this.good + this.bad + FRUSTRATION.damping);
    const delta = FRUSTRATION.gain * ratio - FRUSTRATION.relief * (1 - ratio);
    this.frustration = Math.max(0, Math.min(100, this.frustration + delta * dt));
    this.stats.frustrationSum += this.frustration * dt;
    this.stats.peakFrustration = Math.max(this.stats.peakFrustration, this.frustration);
  }

  /** Share of recent transactions that go wrong (0 → 1). */
  get badRatio(): number {
    return this.bad / (this.good + this.bad + FRUSTRATION.damping);
  }

  private compact(): void {
    if (this.packets.length > 64 && this.packets.some((p) => p.dead)) {
      let w = 0;
      for (let r = 0; r < this.packets.length; r++) {
        const p = this.packets[r];
        if (!p.dead) this.packets[w++] = p;
      }
      this.packets.length = w;
    }
    const horizon = this.t - 1.6;
    let cut = 0;
    while (cut < this.effects.length && this.effects[cut].t < horizon) cut++;
    if (cut) this.effects.splice(0, cut);
  }

  private pushLog(level: LogEntry['level'], text: string, action?: LogEntry['action']): void {
    this.log.push({ t: this.t, level, text, action });
    if (this.log.length > 200) this.log.shift();
    this.logVersion++;
  }

  // -------------------------------------------------------------------------
  // Player commands

  /** Configuration change made by the player during the day (recorded for replays). */
  applyConfig(cfg: NetConfig): void {
    this.actions.push({ tick: this.ticks, kind: 'config', config: cloneConfig(cfg) });
    this.reconfigure(cfg);
  }

  private reconfigure(cfg: NetConfig): void {
    this.config = cfg;
    this.addr = computeAddressing(this.level, cfg);
    this.mctx = matchContext(this.level, this.addr);
    this.rules = compileRules(this.level, cfg.rules);
    const q = new Set(cfg.quarantine);
    for (const s of this.states.values()) {
      const was = s.quarantined;
      s.quarantined = q.has(s.node.id);
      if (!was && s.quarantined) {
        this.flush(s);
        this.pushLog('info', T.sim.quarantined(s.node.label));
      } else if (was && !s.quarantined) {
        this.pushLog('info', T.sim.released(s.node.label));
      }
    }
    this.routing.invalidate();
    this.configVersion++;
  }

  dispatch(id: string): { ok: boolean; message: string } {
    const s = this.states.get(id);
    if (!s) return { ok: false, message: T.sim.unknown(id) };
    let job: Technician['job'] = null;
    if (s.down === 'failure') job = 'repair';
    else if (s.node.endpoint && (s.infected || s.quarantined)) job = 'clean';
    if (!job) return { ok: false, message: T.sim.noNeed(s.node.label) };
    if (this.techs.some((t) => t.target === id && (t.state === 'moving' || t.state === 'working'))) {
      return { ok: false, message: T.sim.busyOn(s.node.label) };
    }
    const free = this.techs
      .filter((t) => t.state === 'idle' || t.state === 'returning')
      .sort((a, b) => dist(a.x - s.node.x, a.y - s.node.y) - dist(b.x - s.node.x, b.y - s.node.y));
    const tech = free[0];
    if (!tech) return { ok: false, message: T.sim.allBusy };
    this.actions.push({ tick: this.ticks, kind: 'dispatch', id });
    tech.state = 'moving';
    tech.target = id;
    tech.job = job;
    tech.workTotal = job === 'repair' ? REPAIR_TIME : CLEAN_TIME;
    tech.path = this.manhattan(tech, { x: s.node.x, y: s.node.y + 0.55 });
    const walk = Math.abs(tech.x - s.node.x) + Math.abs(tech.y - s.node.y - 0.55);
    const speed = TECH_SPEED * (this.skills.has('tech_speed') ? 1.6 : 1);
    const eta = Math.round(walk / speed + tech.workTotal);
    const msg = T.sim.enRoute(tech.id, job === 'repair', s.node.label, eta);
    this.pushLog('info', msg);
    return { ok: true, message: msg };
  }

  // -------------------------------------------------------------------------
  // Analysis (console)

  private top(map: Map<string, Rate>, minAbs: number, margin: number): TopEntry[] {
    const label = (id: string) => this.states.get(id)?.node.label ?? id;
    return [...map.entries()]
      .filter(([, r]) => r.fast >= 0.3)
      .map(([key, r]) => ({
        key,
        label: label(key),
        pps: Math.round(r.fast * 10) / 10,
        dsts: [...r.lastDsts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([d]) => label(d)),
        anomalous: r.fast >= Math.max(minAbs, 2.5 * r.slow + margin),
      }))
      .sort((a, b) => b.pps - a.pps);
  }

  /** Traffic per port (recent packets/s), anomalies flagged against the baseline. */
  topPorts(): TopEntry[] {
    return this.top(this.portRates, 10, 5);
  }

  /**
   * Traffic per source. A source is abnormal when it sends at least three times more than the
   * median of its population (internal hosts on one side, Internet /16 ranges on the other).
   */
  topSources(): TopEntry[] {
    const rows = this.top(this.srcRates, Infinity, 0);
    const median = (xs: number[]) => {
      if (!xs.length) return 0;
      const v = [...xs].sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    const external = (r: TopEntry) => r.key.includes('/');
    const internalRates = [...this.srcRates.entries()].filter(([k]) => !k.includes('/')).map(([, r]) => r.fast);
    const externalRates = [...this.srcRates.entries()].filter(([k]) => k.includes('/')).map(([, r]) => r.fast);
    const mi = median(internalRates);
    const me = median(externalRates);
    for (const r of rows) r.anomalous = r.pps >= Math.max(2.5, 3 * (external(r) ? me : mi));
    return rows;
  }

  recentPackets(n: number): Observed[] {
    return this.recent.slice(-n);
  }

  ipLabel(id: string, ip: number): string {
    return id === this.internetId ? formatIp(ip) : `${this.states.get(id)?.node.label ?? id} (${formatIp(ip)})`;
  }
}
