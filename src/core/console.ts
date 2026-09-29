// Simplified command console (inspired by Hacknet): configuration, diagnostics and crisis management.

import { loc, pctN, T } from '../i18n/index.ts';
import { tempCelsius } from './catalog.ts';
import {
  autoPlan,
  cloneConfig,
  computeAddressing,
  formatRule,
  formatService,
  parseSelector,
  parseService,
  type NetConfig,
} from './config.ts';
import { ICMP, probe, resolveHost, type Issue, type Service } from './diagnostics.ts';
import { formatCidr, formatIp, networkOf, parseCidr } from './ip.ts';
import { clockLabel, groupName, hasFeature, type LevelDef } from './level.ts';
import type { Network } from './network.ts';
import type { Simulation } from './simulation.ts';
import type { Feature, LbMode, Phase, Proto, SkillId } from './types.ts';

export type Tone = 'ok' | 'err' | 'warn' | 'dim' | 'head' | 'cmd' | 'clear';

export interface Line {
  text: string;
  tone?: Tone;
}

export interface ConsoleHost {
  level: LevelDef;
  skills: ReadonlySet<SkillId>;
  phase(): Phase;
  network(): Network;
  config(): NetConfig;
  setConfig(next: NetConfig): void;
  sim(): Simulation | null;
  issues(): Issue[];
  showPath?(path: string[], ok: boolean): void;
}

type CommandId = keyof typeof T.console.cmd;

interface Command {
  id: CommandId;
  names: string[];
  run(args: string[], host: ConsoleHost): Line[];
}

const usage = (c: Command): string => T.console.cmd[c.id].usage;
const helpText = (c: Command): string => T.console.cmd[c.id].help;

const ok = (text: string): Line => ({ text, tone: 'ok' });
const err = (text: string): Line => ({ text, tone: 'err' });
const warn = (text: string): Line => ({ text, tone: 'warn' });
const dim = (text: string): Line => ({ text, tone: 'dim' });
const head = (text: string): Line => ({ text, tone: 'head' });

function needFeature(host: ConsoleHost, f: Feature): Line[] | null {
  if (hasFeature(host.level, f)) return null;
  return [err(T.console.needFeature(T.console.features[f]))];
}

function needSkill(host: ConsoleHost, s: SkillId): Line[] | null {
  if (host.skills.has(s)) return null;
  return [err(T.console.needSkill(T.skills.list[s].name))];
}

function needLive(host: ConsoleHost): Line[] | null {
  if (host.sim()) return null;
  return [err(T.console.needLive)];
}

function pad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? `${str} ` : str + ' '.repeat(n - str.length);
}

function mutate(host: ConsoleHost, fn: (c: NetConfig) => void): void {
  const next = cloneConfig(host.config());
  fn(next);
  host.setConfig(next);
}

/** "udp 123", "udp/123", "123" → service. */
function serviceArgs(args: string[]): { proto: Proto | 'any'; port: number | null } | null {
  if (args.length >= 2 && /^(tcp|udp)$/i.test(args[0]) && /^\d+$/.test(args[1])) {
    return parseService(`${args[0]}/${args[1]}`);
  }
  return args[0] ? parseService(args[0]) : null;
}

function probeService(raw: string | undefined): Service | null {
  if (!raw) return ICMP;
  const s = parseService(raw);
  if (!s || s.proto === 'any' || s.port === null) return null;
  return { proto: s.proto, port: s.port };
}

function nodeLabel(net: Network, id: string): string {
  return net.byId.get(id)?.label ?? id;
}

const COMMANDS: Command[] = [
  {
    id: 'help',
    names: ['help', 'aide', '?'],
    run(args) {
      if (args[0]) {
        const c = find(args[0]);
        if (!c) return [err(T.console.help.unknown(args[0]))];
        return [head(usage(c)), { text: helpText(c) }, dim(T.console.help.aliases(c.names.join(', ')))];
      }
      return [head(T.console.help.title), ...COMMANDS.map((c) => ({ text: `${pad(usage(c), 34)}${helpText(c)}` }))];
    },
  },
  {
    id: 'clear',
    names: ['clear', 'effacer', 'cls'],
    run: () => [{ text: '', tone: 'clear' }],
  },
  {
    id: 'status',
    names: ['status', 'etat', 'état'],
    run(_args, host) {
      const sim = host.sim();
      const net = host.network();
      const S = T.console.status;
      if (!sim) {
        const issues = host.issues();
        const eq = net.nodes.filter((n) => n.transit).length;
        const lines: Line[] = [head(S.design(eq, net.links.filter((l) => l.kind !== 'wifi').length))];
        if (!issues.length) lines.push(ok(S.ready));
        for (const i of issues) lines.push(i.level === 'info' ? dim(i.text) : i.level === 'error' ? err(i.text) : warn(i.text));
        return lines;
      }
      const [c1, c2, c3, c4] = S.cols;
      const lines: Line[] = [head(`${pad(c1, 12)}${pad(c2, 9)}${pad(c3, 8)}${c4}`)];
      for (const s of sim.states.values()) {
        const n = s.node;
        if (!n.transit && n.kind !== 'server') continue;
        const state = s.down === 'failure' ? S.down : s.down === 'overheat' ? S.overheat : s.heat > 0.8 ? S.hot : S.ok;
        const line = `${pad(n.label, 12)}${pad(pctN(s.load * 100), 9)}${pad(`${tempCelsius(s.heat)} °C`, 8)}${state}`;
        lines.push(state === S.ok ? { text: line } : state === S.hot ? warn(line) : err(line));
      }
      const hot = net.links.filter((l) => sim.linkUtil(l.id) > 0.9);
      if (hot.length) lines.push(warn(S.saturated(hot.length, hot.map((l) => `${nodeLabel(net, l.a)}↔${nodeLabel(net, l.b)}`).join(', '))));
      lines.push(dim(S.footer(sim.frustration, sim.clock)));
      return lines;
    },
  },
  {
    id: 'hosts',
    names: ['hosts', 'ip', 'postes'],
    run(args, host) {
      const addr = computeAddressing(host.level, host.config());
      const filter = args[0]?.toLowerCase();
      const group = filter ? host.level.groups.find((g) => g.id === filter || g.aliases?.includes(filter)) : undefined;
      const [c1, c2, c3, c4] = T.console.hosts.cols;
      const lines: Line[] = [head(`${pad(c1, 12)}${pad(c2, 16)}${pad(c3, 6)}${c4}`)];
      for (const e of host.level.endpoints) {
        if (e.kind === 'internet') continue;
        if (filter && e.group !== (group?.id ?? filter) && e.pool !== filter) continue;
        const ip = addr.ipOf.get(e.id);
        const ipText = ip === undefined ? T.console.hosts.none : formatIp(ip);
        const label = e.label ? loc(e.label) : e.id.toUpperCase();
        const line = `${pad(label, 12)}${pad(groupName(host.level, e.group), 16)}${pad(addr.vlanOf.get(e.id) ?? '-', 6)}${ipText}`;
        lines.push(ip === undefined ? warn(line) : { text: line });
      }
      return lines;
    },
  },
  {
    id: 'vlan',
    names: ['vlan'],
    run(args, host) {
      const lvl = host.level;
      const V = T.console.vlan;
      if (!args.length) {
        const [c1, c2, c3, c4] = V.cols;
        const lines: Line[] = [head(`${pad(c1, 18)}${pad(c2, 8)}${pad(c3, 6)}${c4}`)];
        for (const g of lvl.groups) {
          const n = lvl.endpoints.filter((e) => e.group === g.id).length;
          lines.push({ text: `${pad(loc(g.name), 18)}${pad(g.id, 8)}${pad(host.config().vlans[g.id] ?? 1, 6)}${n}` });
        }
        return lines;
      }
      const gate = needFeature(host, 'vlan');
      if (gate) return gate;
      const key = args[0].toLowerCase();
      const g = lvl.groups.find((x) => x.id === key || x.aliases?.includes(key));
      if (!g) return [err(V.unknownGroup(args[0], lvl.groups.map((x) => x.id).join(', ')))];
      const id = Number(args[1]);
      if (!Number.isInteger(id) || id < 1 || id > 4094) return [err(V.range)];
      mutate(host, (c) => (c.vlans[g.id] = id));
      return [ok(V.set(loc(g.name), id))];
    },
  },
  {
    id: 'subnet',
    names: ['subnet', 'sousreseau', 'sous-reseau'],
    run(args, host) {
      const lvl = host.level;
      const S = T.console.subnet;
      if (lvl.addressing.mode !== 'manual') return [dim(S.auto)];
      const addr = computeAddressing(lvl, host.config());
      if (!args.length) {
        const [c1, c2, c3, c4] = S.cols;
        const lines: Line[] = [head(S.block(lvl.addressing.block)), head(`${pad(c1, 6)}${pad(c2, 18)}${pad(c3, 10)}${c4}`)];
        for (const v of addr.vlans) {
          const line = `${pad(v.vlan, 6)}${pad(v.cidr ?? '—', 18)}${pad(`${v.hosts}/${Math.max(0, v.usable - 1)}`, 10)}${v.ok ? '✔' : `✖ ${v.error}`}`;
          lines.push(v.ok ? { text: line } : warn(line));
        }
        return lines;
      }
      const gate = needFeature(host, 'subnets');
      if (gate) return gate;
      const vlan = Number(args[0]);
      if (!Number.isInteger(vlan) || vlan < 1 || vlan > 4094) return [err(S.usage)];
      if (!args[1]) return [err(S.needCidr)];
      if (['none', 'aucun', 'aucune'].includes(args[1].toLowerCase())) {
        mutate(host, (c) => delete c.subnets[String(vlan)]);
        return [ok(S.removed(vlan))];
      }
      const c = parseCidr(args[1]);
      if (!c) return [err(S.badFormat(args[1]))];
      mutate(host, (cfg) => (cfg.subnets[String(vlan)] = formatCidr(c)));
      const st = computeAddressing(lvl, host.config()).vlans.find((v) => v.vlan === vlan);
      if (!st) return [warn(S.unused(vlan))];
      return st.ok
        ? [ok(S.set(vlan, formatCidr(c), st.hosts, st.usable - 1 - st.hosts))]
        : [err(S.setError(vlan, formatCidr(c), `${st.error}${st.hint ? ` ${st.hint}` : ''}`))];
    },
  },
  {
    id: 'fw',
    names: ['fw', 'firewall', 'parefeu'],
    run(args, host) {
      const cfg = host.config();
      const F = T.console.fw;
      const sub = (args[0] ?? 'list').toLowerCase();
      if (sub === 'list' || sub === 'ls') {
        if (!cfg.rules.length) return [dim(F.empty)];
        const hits = host.sim()?.ruleHits;
        const [c1, c2, c3] = F.cols;
        const lines: Line[] = [head(`${pad(c1, 4)}${pad(c2, 52)}${c3}`)];
        cfg.rules.forEach((r, i) => lines.push({ text: `${pad(i + 1, 4)}${pad(formatRule(r), 52)}${hits?.get(r.id) ?? 0}` }));
        lines.push(dim(F.policy));
        return lines;
      }
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      if (sub === 'deny' || sub === 'allow' || sub === 'bloquer' || sub === 'autoriser') {
        const action = sub === 'deny' || sub === 'bloquer' ? 'deny' : 'allow';
        if (args.length < 3) return [err(F.usage)];
        const src = parseSelector(args[1], host.level);
        if ('error' in src) return [err(src.error)];
        const dst = parseSelector(args[2], host.level);
        if ('error' in dst) return [err(dst.error)];
        const svc = parseService(args[3]);
        if (!svc) return [err(F.badService(args[3]))];
        let text = '';
        mutate(host, (c) => {
          const rule = { id: c.seq++, action, src: args[1].toLowerCase(), dst: args[2].toLowerCase(), ...svc } as const;
          c.rules.push({ ...rule });
          text = F.added(c.rules.length, formatRule(rule));
        });
        return [ok(text)];
      }
      if (sub === 'del' || sub === 'rm' || sub === 'suppr') {
        const n = Number(args[1]);
        if (!Number.isInteger(n) || n < 1 || n > cfg.rules.length) return [err(F.badIndex)];
        mutate(host, (c) => c.rules.splice(n - 1, 1));
        return [ok(F.deleted(n))];
      }
      if (sub === 'up' || sub === 'monter') {
        const n = Number(args[1]);
        if (!Number.isInteger(n) || n < 2 || n > cfg.rules.length) return [err(F.badUp)];
        mutate(host, (c) => {
          const [r] = c.rules.splice(n - 1, 1);
          c.rules.splice(n - 2, 0, r);
        });
        return [ok(F.moved(n))];
      }
      if (sub === 'flush' || sub === 'vider') {
        mutate(host, (c) => (c.rules = []));
        return [ok(F.flushed)];
      }
      return [err(F.unknownSub(args[0]))];
    },
  },
  {
    id: 'block',
    names: ['block', 'bloquer'],
    run(args, host) {
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      const svc = serviceArgs(args);
      if (!svc || svc.port === null) return [err(T.console.block.usage)];
      const exists = host.config().rules.some(
        (r) => r.action === 'deny' && r.src === 'any' && r.dst === 'any' && r.proto === svc.proto && r.port === svc.port,
      );
      if (exists) return [dim(T.console.block.already(formatService(svc.proto, svc.port)))];
      mutate(host, (c) => c.rules.unshift({ id: c.seq++, action: 'deny', src: 'any', dst: 'any', proto: svc.proto, port: svc.port }));
      return [ok(T.console.block.done(formatService(svc.proto, svc.port)))];
    },
  },
  {
    id: 'unblock',
    names: ['unblock', 'debloquer', 'débloquer'],
    run(args, host) {
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      const svc = serviceArgs(args);
      if (!svc || svc.port === null) return [err(T.console.unblock.usage)];
      const before = host.config().rules.length;
      mutate(host, (c) => {
        c.rules = c.rules.filter(
          (r) => !(r.action === 'deny' && r.src === 'any' && r.dst === 'any' && r.proto === svc.proto && r.port === svc.port),
        );
      });
      const removed = before - host.config().rules.length;
      return removed ? [ok(T.console.unblock.done(formatService(svc.proto, svc.port)))] : [dim(T.console.unblock.none)];
    },
  },
  {
    id: 'blockip',
    names: ['blockip', 'bloquerip'],
    run(args, host) {
      const gate = needFeature(host, 'firewall');
      if (gate) return gate;
      const c = args[0] ? parseCidr(args[0].includes('/') ? args[0] : `${args[0]}/32`) : null;
      if (!c) return [err(T.console.blockip.usage)];
      const cidr = formatCidr(networkOf(c));
      mutate(host, (cfg) => cfg.rules.unshift({ id: cfg.seq++, action: 'deny', src: cidr, dst: 'any', proto: 'any', port: null }));
      return [ok(T.console.blockip.done(cidr))];
    },
  },
  {
    id: 'ratelimit',
    names: ['ratelimit', 'limiter'],
    run(args, host) {
      const gate = needSkill(host, 'ratelimit');
      if (gate) return gate;
      const R = T.console.ratelimit;
      const cfg = host.config();
      if (!args.length) {
        if (!cfg.rateLimits.length) return [dim(R.none)];
        return cfg.rateLimits.map((r) => ({ text: R.row(formatService(r.proto, r.port), r.pps) }));
      }
      const off = args[0].toLowerCase() === 'off';
      const svc = parseService(off ? args[1] : args[0]);
      if (!svc || svc.proto === 'any' || svc.port === null) return [err(R.usage)];
      const proto = svc.proto;
      const port = svc.port;
      if (off) {
        mutate(host, (c) => (c.rateLimits = c.rateLimits.filter((r) => !(r.proto === proto && r.port === port))));
        return [ok(R.removed(formatService(proto, port)))];
      }
      const pps = Number(args[1]);
      if (!Number.isFinite(pps) || pps <= 0) return [err(R.needPps)];
      mutate(host, (c) => {
        c.rateLimits = c.rateLimits.filter((r) => !(r.proto === proto && r.port === port));
        c.rateLimits.push({ id: c.seq++, proto, port, pps });
      });
      return [ok(R.set(formatService(proto, port), pps))];
    },
  },
  {
    id: 'lb',
    names: ['lb', 'repartition'],
    run(args, host) {
      const L = T.console.lb;
      const pools = [...new Set(host.level.endpoints.filter((e) => e.pool).map((e) => e.pool!))];
      if (!args.length) {
        return pools.map((p) => {
          const n = host.level.endpoints.filter((e) => e.pool === p).length;
          return { text: `${pad(p, 12)}${pad(L.servers(n), 14)}${L.modes[host.config().lb[p] ?? 'none']}` };
        });
      }
      const gate = needFeature(host, 'lb');
      if (gate) return gate;
      const pool = args[0].toLowerCase();
      if (!pools.includes(pool)) return [err(L.unknownPool(args[0], pools.join(', ')))];
      const raw = (args[1] ?? '').toLowerCase();
      const mode: LbMode | null =
        raw === 'none' || raw === 'aucune'
          ? 'none'
          : raw === 'rr' || raw === 'round-robin'
            ? 'rr'
            : raw === 'least' || raw === 'moins'
              ? 'least'
              : null;
      if (!mode) return [err(L.badMode)];
      if (mode === 'least') {
        const g = needSkill(host, 'lb_least');
        if (g) return g;
      }
      mutate(host, (c) => (c.lb[pool] = mode));
      return [ok(L.set(pool, L.modes[mode]))];
    },
  },
  {
    id: 'quarantine',
    names: ['quarantine', 'isoler', 'quarantaine'],
    run(args, host) {
      const gate = needFeature(host, 'quarantine');
      if (gate) return gate;
      const Q = T.console.quarantine;
      const e = host.level.endpoints.find((x) => x.id === (args[0] ?? '').toLowerCase());
      if (!e || (e.kind !== 'workstation' && e.kind !== 'laptop')) return [err(Q.usage)];
      if (host.config().quarantine.includes(e.id)) return [dim(Q.already(e.id.toUpperCase()))];
      mutate(host, (c) => c.quarantine.push(e.id));
      return [ok(Q.done(e.id.toUpperCase(), e.id))];
    },
  },
  {
    id: 'release',
    names: ['release', 'liberer', 'libérer'],
    run(args, host) {
      const R = T.console.release;
      const id = (args[0] ?? '').toLowerCase();
      if (!host.config().quarantine.includes(id)) return [err(R.notQuarantined(id || '?'))];
      mutate(host, (c) => (c.quarantine = c.quarantine.filter((x) => x !== id)));
      const infected = host.sim()?.states.get(id)?.infected;
      return infected ? [warn(R.stillInfected(id.toUpperCase()))] : [ok(R.done(id.toUpperCase()))];
    },
  },
  {
    id: 'dispatch',
    names: ['dispatch', 'tech', 'technicien'],
    run(args, host) {
      const gate = needLive(host);
      if (gate) return gate;
      const id = (args[0] ?? '').toLowerCase();
      if (!id) return [err(T.console.dispatch.usage)];
      const r = host.sim()!.dispatch(id);
      return [r.ok ? ok(r.message) : err(r.message)];
    },
  },
  {
    id: 'ping',
    names: ['ping'],
    run: (args, host) => runProbe(args, host, false),
  },
  {
    id: 'traceroute',
    names: ['traceroute', 'tracert', 'trace'],
    run: (args, host) => runProbe(args, host, true),
  },
  {
    id: 'top',
    names: ['top'],
    run(args, host) {
      const gate = needLive(host);
      if (gate) return gate;
      const P = T.console.top;
      const sim = host.sim()!;
      if ((args[0] ?? '').toLowerCase().startsWith('src')) {
        const rows = sim.topSources().slice(0, 10);
        if (!rows.length) return [dim(P.wait)];
        const [c1, c2] = P.srcCols;
        return [
          head(`${pad(c1, 20)}${c2}`),
          ...rows.map((r) => {
            const line = `${pad(r.label, 20)}${r.pps}`;
            return r.anomalous ? warn(`${line}   ${P.anomalous}`) : { text: line };
          }),
        ];
      }
      const rows = sim.topPorts().slice(0, 10);
      if (!rows.length) return [dim(P.wait)];
      const [c1, c2, c3] = P.portCols;
      return [
        head(`${pad(c1, 13)}${pad(c2, 8)}${c3}`),
        ...rows.map((r) => {
          const line = `${pad(r.key.toUpperCase(), 13)}${pad(r.pps, 8)}${r.dsts.join(', ')}`;
          return r.anomalous ? warn(`${line}   ${P.anomalous}`) : { text: line };
        }),
      ];
    },
  },
  {
    id: 'tcpdump',
    names: ['tcpdump', 'capture'],
    run(args, host) {
      const gate = needLive(host);
      if (gate) return gate;
      const sim = host.sim()!;
      const n = Math.min(40, Math.max(1, Number(args[0]) || 12));
      const rows = sim.recentPackets(n);
      if (!rows.length) return [dim(T.console.tcpdump.nothing)];
      return rows.map((r) => ({
        text: `${clockLabel(r.t / sim.dayLength)}  ${pad(r.proto.toUpperCase(), 4)}${sim.ipLabel(r.src, r.srcIp)} → ${sim.ipLabel(r.dst, r.dstIp)}:${r.port}`,
      }));
    },
  },
  {
    id: 'autovlan',
    names: ['autovlan'],
    run(_args, host) {
      const gate = needSkill(host, 'autovlan') ?? needFeature(host, 'vlan');
      if (gate) return gate;
      const plan = autoPlan(host.level);
      if (typeof plan === 'string') return [err(plan)];
      mutate(host, (c) => {
        c.vlans = { ...c.vlans, ...plan.vlans };
        c.subnets = { ...plan.subnets };
      });
      const lines: Line[] = [ok(T.console.autovlan.applied)];
      for (const g of host.level.groups) {
        const v = plan.vlans[g.id];
        lines.push({ text: `  ${pad(loc(g.name), 18)}VLAN ${pad(v, 6)}${plan.subnets[String(v)] ?? T.console.autovlan.dhcp}` });
      }
      return lines;
    },
  },
];

function find(name: string): Command | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find((c) => c.names.includes(n));
}

function runProbe(args: string[], host: ConsoleHost, verbose: boolean): Line[] {
  const P = T.console.probe;
  if (args.length < 2) return [err(P.usage)];
  const a = resolveHost(host.level, args[0]);
  const b = resolveHost(host.level, args[1]);
  if (!a) return [err(P.unknownSrc(args[0]))];
  if (!b) return [err(P.unknownDst(args[1]))];
  const svc = probeService(args[2]);
  if (!svc) return [err(P.badService(args[2]))];
  const sim = host.sim();
  const result = probe(host.level, host.network(), host.config(), a, b, svc, sim ? (id) => sim.isUp(id) : undefined);
  host.showPath?.(result.path ?? [a], result.ok);
  const lines = verbose ? result.lines : [result.lines[0], result.lines[result.lines.length - 1]];
  return lines.map((text, i) => (i === lines.length - 1 ? (result.ok ? ok(text) : err(text)) : i === 0 ? head(text) : { text }));
}

export function execute(input: string, host: ConsoleHost): Line[] {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const cmd = find(words[0]);
  if (!cmd) return [err(T.console.unknown(words[0]))];
  try {
    return cmd.run(words.slice(1), host);
  } catch (e) {
    return [err(T.console.internal((e as Error).message))];
  }
}

export function commandNames(): string[] {
  return COMMANDS.flatMap((c) => c.names);
}
