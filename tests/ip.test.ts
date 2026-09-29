import { describe, expect, it } from 'vitest';
import {
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
} from '../src/core/ip.ts';

describe('IPv4', () => {
  it('parses and formats addresses', () => {
    expect(formatIp(parseIp('10.42.0.17')!)).toBe('10.42.0.17');
    expect(parseIp('255.255.255.255')).toBe(0xffffffff);
    expect(parseIp('10.0.0')).toBeNull();
    expect(parseIp('10.0.0.256')).toBeNull();
    expect(parseIp('a.b.c.d')).toBeNull();
  });

  it('parses CIDR blocks', () => {
    expect(formatCidr(parseCidr('10.42.0.16/29')!)).toBe('10.42.0.16/29');
    expect(parseCidr('10.42.0.16/33')).toBeNull();
    expect(parseCidr('10.42.0.16')).toBeNull();
  });

  it('checks alignment and suggests the network address', () => {
    expect(isAligned(parseCidr('10.42.0.16/28')!)).toBe(true);
    expect(isAligned(parseCidr('10.42.0.8/28')!)).toBe(false);
    expect(formatCidr(networkOf(parseCidr('10.42.0.8/28')!))).toBe('10.42.0.0/28');
  });

  it('counts usable hosts', () => {
    expect(usableHosts(24)).toBe(254);
    expect(usableHosts(28)).toBe(14);
    expect(usableHosts(29)).toBe(6);
    expect(usableHosts(30)).toBe(2);
    expect(prefixFor(14)).toBe(28);
    expect(prefixFor(15)).toBe(27);
    expect(prefixFor(6)).toBe(29);
  });

  it('detects overlaps and inclusions', () => {
    const block = parseCidr('10.42.0.0/27')!;
    expect(within(parseCidr('10.42.0.24/29')!, block)).toBe(true);
    expect(within(parseCidr('10.42.0.32/29')!, block)).toBe(false);
    expect(overlaps(parseCidr('10.42.0.0/28')!, parseCidr('10.42.0.8/29')!)).toBe(true);
    expect(overlaps(parseCidr('10.42.0.0/28')!, parseCidr('10.42.0.16/29')!)).toBe(false);
  });
});
