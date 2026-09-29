import { describe, expect, it } from 'vitest';
import {
  autoPlan,
  compileRules,
  computeAddressing,
  defaultConfig,
  firstMatch,
  matchContext,
  parseSelector,
  parseService,
  type NetConfig,
} from '../src/core/config.ts';
import { formatIp } from '../src/core/ip.ts';
import { levelById } from '../src/core/levels.ts';
import { miniLevel } from './helpers.ts';

const bionova = levelById('bionova')!;

function manual(subnets: Record<string, string>, vlans = { rnd: 20, acct: 10, srv: 99 }): NetConfig {
  return { ...defaultConfig(bionova), vlans, subnets };
}

describe('manual addressing (BioNova, block 10.42.0.0/27)', () => {
  it('accepts the tight VLSM plan', () => {
    const addr = computeAddressing(bionova, manual({ '20': '10.42.0.0/28', '10': '10.42.0.16/29', '99': '10.42.0.24/29' }));
    expect(addr.vlans.every((v) => v.ok)).toBe(true);
    expect(addr.missing).toEqual([]);
    expect(formatIp(addr.gateway.get(10)!)).toBe('10.42.0.17');
    expect(formatIp(addr.ipOf.get('ac-1')!)).toBe('10.42.0.18');
  });

  it('reports a missing subnet', () => {
    const addr = computeAddressing(bionova, manual({ '20': '10.42.0.0/28', '10': '10.42.0.16/29' }));
    const v99 = addr.vlans.find((v) => v.vlan === 99)!;
    expect(v99.ok).toBe(false);
    expect(v99.error).toMatch(/No subnet/);
    expect(addr.missing).toContain('erp');
  });

  it('reports a subnet that is too small and only addresses the first hosts', () => {
    const addr = computeAddressing(bionova, manual({ '20': '10.42.0.0/29', '10': '10.42.0.16/29', '99': '10.42.0.24/29' }));
    const v20 = addr.vlans.find((v) => v.vlan === 20)!;
    expect(v20.ok).toBe(false);
    expect(v20.error).toMatch(/Too small/);
    expect(v20.hint).toMatch(/\/28/);
    expect(addr.missing.filter((id) => id.startsWith('rd-'))).toHaveLength(13 - 5);
  });

  it('refuses a misaligned address and suggests the right one', () => {
    const addr = computeAddressing(bionova, manual({ '20': '10.42.0.0/28', '10': '10.42.0.20/29', '99': '10.42.0.24/29' }));
    const v10 = addr.vlans.find((v) => v.vlan === 10)!;
    expect(v10.ok).toBe(false);
    expect(v10.hint).toMatch(/10\.42\.0\.16\/29/);
  });

  it('refuses overlaps and subnets outside the block', () => {
    const overlap = computeAddressing(bionova, manual({ '20': '10.42.0.0/28', '10': '10.42.0.8/29', '99': '10.42.0.24/29' }));
    expect(overlap.vlans.filter((v) => !v.ok).map((v) => v.vlan).sort()).toEqual([10, 20]);
    const outside = computeAddressing(bionova, manual({ '20': '10.42.0.0/28', '10': '10.42.0.16/29', '99': '10.42.0.32/29' }));
    expect(outside.vlans.find((v) => v.vlan === 99)!.error).toMatch(/Outside the block/);
  });

  it('accepts group aliases typed in another language', () => {
    expect(parseSelector('compta', bionova)).toEqual({ t: 'group', id: 'acct' });
  });

  it('the Auto-VLAN script produces a valid plan', () => {
    const plan = autoPlan(bionova);
    if (typeof plan === 'string') throw new Error(plan);
    const addr = computeAddressing(bionova, { ...defaultConfig(bionova), ...plan });
    expect(addr.vlans.every((v) => v.ok)).toBe(true);
  });
});

describe('automatic addressing', () => {
  it('gives a /24 per VLAN', () => {
    const lvl = miniLevel();
    const addr = computeAddressing(lvl, { ...defaultConfig(lvl), vlans: { ga: 10, gb: 20, srv: 1 } });
    expect(formatIp(addr.ipOf.get('a1')!)).toBe('10.0.10.10');
    expect(formatIp(addr.ipOf.get('b1')!)).toBe('10.0.20.10');
    expect(addr.vlanOf.get('net')).toBe(0);
  });
});

describe('firewall', () => {
  const lvl = miniLevel();

  it('parses selectors', () => {
    expect(parseSelector('ga', lvl)).toEqual({ t: 'group', id: 'ga' });
    expect(parseSelector('db', lvl)).toEqual({ t: 'pool', id: 'db' });
    expect(parseSelector('vlan20', lvl)).toEqual({ t: 'vlan', v: 20 });
    expect(parseSelector('A1', lvl)).toEqual({ t: 'host', id: 'a1' });
    expect(parseSelector('internet', lvl)).toEqual({ t: 'internet' });
    expect(parseSelector('any', lvl)).toEqual({ t: 'any' });
    expect(parseSelector('ISP', lvl)).toEqual({ t: 'internet' });
    expect(parseSelector('185.220.1.9/16', lvl)).toMatchObject({ t: 'cidr' });
    expect(parseSelector('unknown', lvl)).toHaveProperty('error');
  });

  it('parses services', () => {
    expect(parseService('tcp/445')).toEqual({ proto: 'tcp', port: 445 });
    expect(parseService('udp:123')).toEqual({ proto: 'udp', port: 123 });
    expect(parseService('443')).toEqual({ proto: 'any', port: 443 });
    expect(parseService(undefined)).toEqual({ proto: 'any', port: null });
    expect(parseService('tcp/70000')).toBeNull();
  });

  it('applies the first matching rule', () => {
    const cfg = defaultConfig(lvl);
    cfg.rules = [
      { id: 1, action: 'allow', src: 'a1', dst: 'db', proto: 'any', port: null },
      { id: 2, action: 'deny', src: 'ga', dst: 'db', proto: 'tcp', port: 5432 },
    ];
    const addr = computeAddressing(lvl, cfg);
    const ctx = matchContext(lvl, addr);
    const rules = compileRules(lvl, cfg.rules);
    const pkt = (src: string) => ({
      src,
      dst: 'db',
      srcIp: addr.ipOf.get(src)!,
      dstIp: addr.ipOf.get('db')!,
      proto: 'tcp' as const,
      port: 5432,
    });
    expect(firstMatch(rules, pkt('a1'), ctx)!.rule.id).toBe(1);
    expect(firstMatch(rules, pkt('a2'), ctx)!.rule.id).toBe(2);
    expect(firstMatch(rules, pkt('b1'), ctx)).toBeNull();
    expect(firstMatch(rules, { ...pkt('a2'), proto: 'icmp', port: 0 }, ctx)).toBeNull();
  });
});
