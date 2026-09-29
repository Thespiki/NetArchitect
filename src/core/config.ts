// Logical configuration: VLANs, subnets, firewall, load balancing, quarantine.

import { allForms, T } from '../i18n/index.ts';
import {
  blockSize,
  contains,
  formatCidr,
  formatIp,
  isAligned,
  networkOf,
  overlaps,
  parseCidr,
  parseIp,
  prefixFor,
  usableHosts,
  within,
  type Cidr,
} from './ip.ts';
import type { LevelDef } from './level.ts';
import type { LbMode, Proto } from './types.ts';

export type RuleProto = Proto | 'any';

export interface FwRule {
  id: number;
  action: 'allow' | 'deny';
  src: string;
  dst: string;
  proto: RuleProto;
  port: number | null;
}

export interface RateLimit {
  id: number;
  proto: Proto;
  port: number;
  pps: number;
}

export interface NetConfig {
  /** Group → VLAN id. */
  vlans: Record<string, number>;
  /** VLAN → CIDR subnet (manual addressing). */
  subnets: Record<string, string>;
  rules: FwRule[];
  lb: Record<string, LbMode>;
  quarantine: string[];
  rateLimits: RateLimit[];
  seq: number;
}

export const INTERNET_IP = parseIp('203.0.113.1')!;
export const PUBLIC_IP = parseIp('198.51.100.10')!;

export function defaultConfig(level: LevelDef): NetConfig {
  const vlans: Record<string, number> = {};
  for (const g of level.groups) vlans[g.id] = 1;
  const lb: Record<string, LbMode> = {};
  for (const e of level.endpoints) if (e.pool) lb[e.pool] = 'none';
  return { vlans, subnets: {}, rules: [], lb, quarantine: [], rateLimits: [], seq: 1 };
}

export function cloneConfig(c: NetConfig): NetConfig {
  return {
    vlans: { ...c.vlans },
    subnets: { ...c.subnets },
    rules: c.rules.map((r) => ({ ...r })),
    lb: { ...c.lb },
    quarantine: [...c.quarantine],
    rateLimits: c.rateLimits.map((r) => ({ ...r })),
    seq: c.seq,
  };
}

/** Completes a saved configuration with the level's groups and pools (robustness). */
export function normalizeConfig(level: LevelDef, c: NetConfig): NetConfig {
  const base = defaultConfig(level);
  return {
    ...base,
    ...c,
    vlans: { ...base.vlans, ...c.vlans },
    lb: { ...base.lb, ...c.lb },
    subnets: { ...c.subnets },
    rules: c.rules ?? [],
    quarantine: c.quarantine ?? [],
    rateLimits: c.rateLimits ?? [],
    seq: c.seq ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Addressing

export interface VlanStatus {
  vlan: number;
  groups: string[];
  cidr: string | null;
  hosts: number;
  usable: number;
  ok: boolean;
  error?: string;
  hint?: string;
}

export interface Addressing {
  ipOf: Map<string, number>;
  vlanOf: Map<string, number>;
  gateway: Map<number, number>;
  vlans: VlanStatus[];
  /** Hosts without an IP address (subnet missing, invalid or too small). */
  missing: string[];
}

export function vlanOfGroup(config: NetConfig, group: string | undefined): number {
  if (!group) return 1;
  return config.vlans[group] ?? 1;
}

function autoSubnet(vlan: number): Cidr {
  return { base: parseIp(`10.${(vlan >> 8) & 255}.${vlan & 255}.0`)!, prefix: 24 };
}

export function computeAddressing(level: LevelDef, config: NetConfig): Addressing {
  const ipOf = new Map<string, number>();
  const vlanOf = new Map<string, number>();
  const gateway = new Map<number, number>();
  const members = new Map<number, string[]>();
  const groupsOf = new Map<number, Set<string>>();

  for (const e of level.endpoints) {
    if (e.kind === 'internet') {
      vlanOf.set(e.id, 0);
      ipOf.set(e.id, INTERNET_IP);
      continue;
    }
    const v = vlanOfGroup(config, e.group);
    vlanOf.set(e.id, v);
    const list = members.get(v) ?? [];
    list.push(e.id);
    members.set(v, list);
    const gs = groupsOf.get(v) ?? new Set<string>();
    if (e.group) gs.add(e.group);
    groupsOf.set(v, gs);
  }

  const manual = level.addressing.mode === 'manual';
  const block = level.addressing.mode === 'manual' ? parseCidr(level.addressing.block) : null;
  const vlans = [...members.keys()].sort((a, b) => a - b);
  const parsed = new Map<number, Cidr | null>();
  const statuses = new Map<number, VlanStatus>();

  for (const v of vlans) {
    const hosts = members.get(v)!.length;
    const st: VlanStatus = {
      vlan: v,
      groups: [...groupsOf.get(v)!],
      cidr: null,
      hosts,
      usable: 0,
      ok: true,
    };
    statuses.set(v, st);
    if (!manual) {
      const c = autoSubnet(v);
      parsed.set(v, c);
      st.cidr = formatCidr(c);
      st.usable = usableHosts(c.prefix);
      continue;
    }
    const raw = config.subnets[String(v)];
    if (!raw) {
      parsed.set(v, null);
      st.ok = false;
      st.error = T.config.noSubnet;
      st.hint = T.config.needAtLeast(prefixFor(hosts + 1), hosts);
      continue;
    }
    const c = parseCidr(raw);
    st.cidr = raw;
    if (!c) {
      parsed.set(v, null);
      st.ok = false;
      st.error = T.config.badFormat;
      continue;
    }
    st.cidr = formatCidr(c);
    st.usable = usableHosts(c.prefix);
    if (!isAligned(c)) {
      parsed.set(v, null);
      st.ok = false;
      st.error = T.config.misaligned;
      st.hint = T.config.nearest(formatCidr(networkOf(c)));
      continue;
    }
    if (block && !within(c, block)) {
      parsed.set(v, null);
      st.ok = false;
      st.error = T.config.outsideBlock(formatCidr(block));
      continue;
    }
    parsed.set(v, c);
  }

  // Overlaps between valid subnets.
  for (let i = 0; i < vlans.length; i++) {
    for (let j = i + 1; j < vlans.length; j++) {
      const a = parsed.get(vlans[i]);
      const b = parsed.get(vlans[j]);
      if (a && b && overlaps(a, b)) {
        for (const [v, o] of [
          [vlans[i], vlans[j]],
          [vlans[j], vlans[i]],
        ]) {
          const st = statuses.get(v)!;
          st.ok = false;
          st.error = T.config.overlaps(o);
        }
      }
    }
  }
  for (const v of vlans) if (!statuses.get(v)!.ok) parsed.set(v, null);

  const missing: string[] = [];
  for (const v of vlans) {
    const c = parsed.get(v) ?? null;
    const list = members.get(v)!;
    const st = statuses.get(v)!;
    if (!c) {
      missing.push(...list);
      continue;
    }
    gateway.set(v, c.base + 1);
    const slots = Math.max(0, usableHosts(c.prefix) - 1);
    if (list.length > slots) {
      st.ok = false;
      st.error = T.config.tooSmall(usableHosts(c.prefix), list.length + 1);
      st.hint = T.config.needPrefix(prefixFor(list.length + 1));
    }
    // .1 = gateway; hosts follow (from .10 with automatic DHCP).
    const first = manual ? 2 : 10;
    const last = c.base + blockSize(c.prefix) - 2;
    list.forEach((id, i) => {
      const ip = c.base + first + i;
      if (ip <= last) ipOf.set(id, ip);
      else missing.push(id);
    });
  }

  return { ipOf, vlanOf, gateway, vlans: vlans.map((v) => statuses.get(v)!), missing };
}

/** "Auto-VLAN & IPAM" script: one VLAN per group and a VLSM split of the block. */
export function autoPlan(level: LevelDef): { vlans: Record<string, number>; subnets: Record<string, string> } | string {
  const vlans: Record<string, number> = {};
  level.groups.forEach((g, i) => (vlans[g.id] = (i + 1) * 10));
  const subnets: Record<string, string> = {};
  if (level.addressing.mode !== 'manual') return { vlans, subnets };
  const block = parseCidr(level.addressing.block);
  if (!block) return T.config.badBlock;
  const needs = level.groups
    .map((g) => ({
      vlan: vlans[g.id],
      prefix: prefixFor(level.endpoints.filter((e) => e.group === g.id).length + 1),
    }))
    .sort((a, b) => a.prefix - b.prefix || a.vlan - b.vlan);
  let cursor = block.base;
  const end = block.base + blockSize(block.prefix);
  for (const n of needs) {
    const size = blockSize(n.prefix);
    cursor = Math.ceil(cursor / size) * size;
    if (cursor + size > end) return T.config.blockTooSmall;
    subnets[String(n.vlan)] = `${formatIp(cursor)}/${n.prefix}`;
    cursor += size;
  }
  return { vlans, subnets };
}

// ---------------------------------------------------------------------------
// Firewall

export type Selector =
  | { t: 'any' }
  | { t: 'internet' }
  | { t: 'group'; id: string }
  | { t: 'pool'; id: string }
  | { t: 'vlan'; v: number }
  | { t: 'host'; id: string }
  | { t: 'cidr'; c: Cidr };

export function parseSelector(raw: string, level: LevelDef): Selector | { error: string } {
  const s = raw.trim().toLowerCase();
  if (s === 'any' || s === '*' || s === 'all' || s === 'tout' || s === 'tous') return { t: 'any' };
  if (s === 'internet' || s === 'wan') return { t: 'internet' };
  const group = level.groups.find((g) => g.id === s || g.aliases?.includes(s));
  if (group) return { t: 'group', id: group.id };
  const pool = level.endpoints.find((e) => e.pool === s);
  if (pool) return { t: 'pool', id: s };
  const vm = /^vlan[:\s-]?(\d{1,4})$/.exec(s);
  if (vm) return { t: 'vlan', v: Number(vm[1]) };
  const host = level.endpoints.find((e) => e.id === s || allForms(e.label).includes(s));
  if (host) return host.kind === 'internet' ? { t: 'internet' } : { t: 'host', id: host.id };
  const c = parseCidr(s.includes('/') ? s : `${s}/32`);
  if (c) return { t: 'cidr', c: networkOf(c) };
  return { error: T.config.unknownSelector(raw) };
}

export function parseService(raw: string | undefined): { proto: RuleProto; port: number | null } | null {
  if (!raw) return { proto: 'any', port: null };
  const s = raw.trim().toLowerCase();
  if (s === 'any' || s === '*') return { proto: 'any', port: null };
  const m = /^(tcp|udp)?[/:]?(\d{1,5})?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  const port = m[2] ? Number(m[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { proto: (m[1] as Proto | undefined) ?? 'any', port };
}

export function formatService(proto: RuleProto, port: number | null): string {
  if (proto === 'any' && port === null) return T.config.serviceAll;
  if (port === null) return proto.toUpperCase();
  if (proto === 'any') return `port ${port}`;
  return `${proto.toUpperCase()}/${port}`;
}

export function formatRule(r: FwRule): string {
  const verb = r.action === 'deny' ? T.config.deny : T.config.allow;
  return `${verb} ${r.src} → ${r.dst} · ${formatService(r.proto, r.port)}`;
}

export interface PacketHeader {
  src: string;
  dst: string;
  srcIp: number;
  dstIp: number;
  proto: Proto | 'icmp';
  port: number;
}

export interface MatchContext {
  level: LevelDef;
  addr: Addressing;
  groupOf: Map<string, string | undefined>;
  poolOf: Map<string, string | undefined>;
  internetIds: Set<string>;
}

export function matchContext(level: LevelDef, addr: Addressing): MatchContext {
  return {
    level,
    addr,
    groupOf: new Map(level.endpoints.map((e) => [e.id, e.group])),
    poolOf: new Map(level.endpoints.map((e) => [e.id, e.pool])),
    internetIds: new Set(level.endpoints.filter((e) => e.kind === 'internet').map((e) => e.id)),
  };
}

export function selectorMatches(sel: Selector, id: string, ip: number, ctx: MatchContext): boolean {
  switch (sel.t) {
    case 'any':
      return true;
    case 'internet':
      return ctx.internetIds.has(id);
    case 'group':
      return ctx.groupOf.get(id) === sel.id;
    case 'pool':
      return ctx.poolOf.get(id) === sel.id;
    case 'vlan':
      return ctx.addr.vlanOf.get(id) === sel.v;
    case 'host':
      return id === sel.id;
    case 'cidr':
      return contains(sel.c, ip);
  }
}

/** Compiled rules: selectors are parsed only once. */
export interface CompiledRule {
  rule: FwRule;
  src: Selector;
  dst: Selector;
}

export function compileRules(level: LevelDef, rules: FwRule[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const rule of rules) {
    const src = parseSelector(rule.src, level);
    const dst = parseSelector(rule.dst, level);
    if ('error' in src || 'error' in dst) continue;
    out.push({ rule, src, dst });
  }
  return out;
}

export function ruleMatches(r: CompiledRule, p: PacketHeader, ctx: MatchContext): boolean {
  if (r.rule.proto !== 'any' && r.rule.proto !== p.proto) return false;
  if (r.rule.port !== null && (p.proto === 'icmp' || r.rule.port !== p.port)) return false;
  return selectorMatches(r.src, p.src, p.srcIp, ctx) && selectorMatches(r.dst, p.dst, p.dstIp, ctx);
}

/** First matching rule; everything is allowed by default. */
export function firstMatch(rules: CompiledRule[], p: PacketHeader, ctx: MatchContext): CompiledRule | null {
  for (const r of rules) if (ruleMatches(r, p, ctx)) return r;
  return null;
}
