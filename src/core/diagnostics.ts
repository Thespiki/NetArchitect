// Diagnostics outside the simulation: pre-launch checks, ping and traceroute.

import { allForms, loc, T } from '../i18n/index.ts';
import {
  compileRules,
  computeAddressing,
  firstMatch,
  formatRule,
  formatService,
  matchContext,
  type Addressing,
  type NetConfig,
  type PacketHeader,
} from './config.ts';
import { brokenCables, designCost, uncabledEndpoints, type Design } from './design.ts';
import { formatIp } from './ip.ts';
import type { LevelDef } from './level.ts';
import type { Network } from './network.ts';
import { Routing } from './routing.ts';
import type { Proto } from './types.ts';

export interface Issue {
  level: 'error' | 'warn' | 'info';
  /** Kind of problem, used by the guides. */
  code: 'budget' | 'broken' | 'isp' | 'uncabled' | 'wifi' | 'vlan' | 'access' | 'site' | 'audit';
  text: string;
  nodes?: string[];
}

export type Service = { proto: Proto | 'icmp'; port: number };

export const ICMP: Service = { proto: 'icmp', port: 0 };

/** Accepts a host id or label, "internet", a group (first host) or a pool (first server). */
export function resolveHost(level: LevelDef, token: string): string | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const direct = level.endpoints.find((e) => e.id === t || allForms(e.label).includes(t));
  if (direct) return direct.id;
  if (t === 'internet' || t === 'wan') return level.endpoints.find((e) => e.kind === 'internet')?.id ?? null;
  const inPool = level.endpoints.find((e) => e.pool === t);
  if (inPool) return inPool.id;
  const group = level.groups.find((g) => g.id === t || g.aliases?.includes(t));
  const inGroup = group && level.endpoints.find((e) => e.group === group.id);
  return inGroup?.id ?? null;
}

export interface Probe {
  ok: boolean;
  path: string[] | null;
  lines: string[];
  blockedAt?: string;
}

interface ProbeContext {
  level: LevelDef;
  net: Network;
  config: NetConfig;
  addr: Addressing;
  routing: Routing;
}

function context(level: LevelDef, net: Network, config: NetConfig, isUp?: (id: string) => boolean): ProbeContext {
  const addr = computeAddressing(level, config);
  const q = new Set(config.quarantine);
  const routing = new Routing(net, isUp ?? ((id) => !q.has(id)));
  return { level, net, config, addr, routing };
}

function label(ctx: ProbeContext, id: string): string {
  return ctx.net.byId.get(id)?.label ?? id;
}

function probeWith(ctx: ProbeContext, src: string, dst: string, svc: Service): Probe {
  const { addr, routing, net } = ctx;
  const lines: string[] = [];
  const srcIp = addr.ipOf.get(src);
  const dstIp = addr.ipOf.get(dst);
  const svcText = svc.proto === 'icmp' ? 'ICMP' : formatService(svc.proto, svc.port);
  const ipText = (ip: number | undefined) => (ip !== undefined ? formatIp(ip) : T.diag.noIp);
  lines.push(`${label(ctx, src)} (${ipText(srcIp)}) → ${label(ctx, dst)} (${ipText(dstIp)}) · ${svcText}`);
  const fail = (text: string, blockedAt?: string, path: string[] | null = null): Probe => {
    lines.push(`✖ ${text}`);
    return { ok: false, path, lines, blockedAt };
  };
  if (ctx.config.quarantine.includes(src)) return fail(T.diag.quarantined(label(ctx, src)));
  if (ctx.config.quarantine.includes(dst)) return fail(T.diag.quarantined(label(ctx, dst)));
  if (srcIp === undefined) return fail(T.diag.hostNoIp(label(ctx, src)));
  if (dstIp === undefined) return fail(T.diag.hostNoIp(label(ctx, dst)));
  const vs = addr.vlanOf.get(src)!;
  const vd = addr.vlanOf.get(dst)!;
  const routed = vs === vd;
  const path = routing.path(src, dst, routed);
  if (!path) {
    const l2 = routing.distance(src, dst, true) < Infinity;
    if (!routed && l2) {
      const a = vs === 0 ? T.diag.internet : T.diag.vlan(vs);
      const b = vd === 0 ? T.diag.internet : T.diag.vlan(vd);
      return fail(T.diag.noL3(a, b));
    }
    return fail(T.diag.noRoute);
  }
  const rules = compileRules(ctx.level, ctx.config.rules);
  const mctx = matchContext(ctx.level, addr);
  const header: PacketHeader = { src, dst, srcIp, dstIp, proto: svc.proto, port: svc.port };
  let r = routed;
  for (let i = 1; i < path.length; i++) {
    const node = net.byId.get(path[i])!;
    let note = '';
    if (node.l3 && !r) {
      r = true;
      const rule = firstMatch(rules, header, mctx);
      if (rule && rule.rule.action === 'deny') {
        lines.push(`  ${String(i).padStart(2)}  ${node.label}  ${T.diag.hopBlocked}`);
        const idx = ctx.config.rules.indexOf(rule.rule) + 1;
        return fail(T.diag.blockedBy(node.label, idx, formatRule(rule.rule)), node.id, path.slice(0, i + 1));
      }
      note = `  ${rule ? T.diag.hopAllowed(ctx.config.rules.indexOf(rule.rule) + 1) : T.diag.hopNoRule}`;
    } else if (node.l3) {
      note = `  ${T.diag.hopSwitched}`;
    }
    lines.push(`  ${String(i).padStart(2)}  ${node.label}${note}`);
  }
  lines.push(T.diag.reachable(path.length - 1));
  return { ok: true, path, lines };
}

export function probe(
  level: LevelDef,
  net: Network,
  config: NetConfig,
  src: string,
  dst: string,
  svc: Service = ICMP,
  isUp?: (id: string) => boolean,
): Probe {
  return probeWith(context(level, net, config, isUp), src, dst, svc);
}

/** Checks shown before launch and during configuration. */
export function preflight(level: LevelDef, design: Design, net: Network, config: NetConfig): Issue[] {
  const issues: Issue[] = [];
  const cost = designCost(level, design);
  if (cost > level.budget) issues.push({ level: 'error', code: 'budget', text: T.diag.overBudget(cost - level.budget) });

  const broken = brokenCables(level, design);
  if (broken.size) issues.push({ level: 'warn', code: 'broken', text: T.diag.tooLongCables(broken.size) });

  const unc = uncabledEndpoints(level, design);
  const inet = unc.filter((e) => e.kind === 'internet');
  const others = unc.filter((e) => e.kind !== 'internet');
  if (inet.length) issues.push({ level: 'warn', code: 'isp', text: T.diag.ispUnlinked, nodes: inet.map((e) => e.id) });
  if (others.length) {
    issues.push({ level: 'warn', code: 'uncabled', text: T.diag.unconnected(others.length), nodes: others.map((e) => e.id) });
  }
  if (net.uncovered.length) {
    issues.push({ level: 'warn', code: 'wifi', text: T.diag.uncovered(net.uncovered.length), nodes: net.uncovered });
  }

  const ctx = context(level, net, config);
  for (const v of ctx.addr.vlans) {
    if (!v.ok) issues.push({ level: 'warn', code: 'vlan', text: T.diag.vlanIssue(v.vlan, `${v.error}${v.hint ? ` ${v.hint}` : ''}`) });
  }

  const internet = level.endpoints.find((e) => e.kind === 'internet');
  const labelOf = (id: string) => net.byId.get(id)?.label ?? id;
  for (const g of level.groups) {
    const gt = level.traffic.groups[g.id];
    if (!gt) continue;
    const members = level.endpoints.filter((e) => e.group === g.id && e.kind !== 'internet');
    const targets: { id: string; name: string; svc: Service }[] = [];
    if (internet && ((gt.mix.web ?? 0) > 0 || (gt.mix.stream ?? 0) > 0)) {
      targets.push({ id: internet.id, name: T.diag.internet, svc: { proto: 'tcp', port: 443 } });
    }
    for (const pool of gt.data ?? []) {
      const srv = level.endpoints.find((e) => e.pool === pool);
      if (srv) targets.push({ id: srv.id, name: pool.toUpperCase(), svc: { proto: srv.proto ?? 'tcp', port: srv.port ?? 445 } });
    }
    for (const t of targets) {
      const failing = members.filter((m) => !probeWith(ctx, m.id, t.id, t.svc).ok);
      if (failing.length) {
        const first = probeWith(ctx, failing[0].id, t.id, t.svc);
        const why = first.lines[first.lines.length - 1].replace(/^✖ /, '');
        issues.push({
          level: 'warn',
          code: 'access',
          text: T.diag.noAccess(loc(g.name), t.name, failing.length, members.length, why),
          nodes: failing.map((m) => m.id),
        });
      }
    }
  }

  const cust = level.traffic.customers;
  if (cust && internet) {
    const servers = level.endpoints.filter((e) => e.pool === cust.pool);
    const ok = servers.filter((s) => probeWith(ctx, internet.id, s.id, { proto: 'tcp', port: 443 }).ok);
    if (!ok.length) issues.push({ level: 'warn', code: 'site', text: T.diag.siteDown(cust.pool.toUpperCase()) });
  }

  for (const a of level.audits ?? []) {
    const from = level.endpoints.filter((e) => e.group === a.from);
    const to = level.endpoints.filter((e) => e.kind !== 'internet' && (e.pool === a.to || e.group === a.to));
    let leak: string | null = null;
    for (const f of from) {
      for (const t of to) {
        if (probeWith(ctx, f.id, t.id, { proto: t.proto ?? 'tcp', port: t.port ?? 445 }).ok) {
          leak = `${labelOf(f.id)} → ${labelOf(t.id)}`;
          break;
        }
      }
      if (leak) break;
    }
    if (leak) issues.push({ level: 'warn', code: 'audit', text: T.diag.auditLeak(loc(a.label), leak) });
  }

  return issues;
}
