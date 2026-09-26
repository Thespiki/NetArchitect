// IPv4 / CIDR helpers (unsigned 32-bit integers).

export interface Cidr {
  base: number;
  prefix: number;
}

export function parseIp(s: string): number | null {
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function formatIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function parseCidr(s: string): Cidr | null {
  const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(s);
  if (!m) return null;
  const base = parseIp(m[1]);
  const prefix = Number(m[2]);
  if (base === null || prefix > 32) return null;
  return { base, prefix };
}

export function formatCidr(c: Cidr): string {
  return `${formatIp(c.base)}/${c.prefix}`;
}

/** The base address has no host bit set. */
export function isAligned(c: Cidr): boolean {
  return ((c.base & ~maskOf(c.prefix)) >>> 0) === 0;
}

export function networkOf(c: Cidr): Cidr {
  return { base: (c.base & maskOf(c.prefix)) >>> 0, prefix: c.prefix };
}

export function blockSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

/** Number of usable addresses (network and broadcast excluded). */
export function usableHosts(prefix: number): number {
  if (prefix >= 32) return 1;
  if (prefix === 31) return 2;
  return blockSize(prefix) - 2;
}

export function contains(c: Cidr, ip: number): boolean {
  const m = maskOf(c.prefix);
  return ((ip & m) >>> 0) === ((c.base & m) >>> 0);
}

export function overlaps(a: Cidr, b: Cidr): boolean {
  const p = Math.min(a.prefix, b.prefix);
  const m = maskOf(p);
  return ((a.base & m) >>> 0) === ((b.base & m) >>> 0);
}

/** `inner` lies entirely within `outer`. */
export function within(inner: Cidr, outer: Cidr): boolean {
  return inner.prefix >= outer.prefix && contains(outer, inner.base);
}

/** Smallest prefix whose block holds `hosts` usable addresses. */
export function prefixFor(hosts: number): number {
  for (let p = 30; p >= 0; p--) {
    if (usableHosts(p) >= hosts) return p;
  }
  return 0;
}
