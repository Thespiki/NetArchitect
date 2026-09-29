// Per-destination routing tables.
// Simplified VLAN rule: links between devices are trunks, but a packet that changes VLAN (or goes
// to the Internet) must cross a layer 3 device (router, L3 switch). A packet therefore carries a
// "routed" flag: false until it has crossed a layer 3 device while its source VLAN differs from
// its destination VLAN.

import { cmp } from './detmath.ts';
import { otherEnd, type NetLink, type Network } from './network.ts';

interface Table {
  /** Distance (hops) to the destination for a packet that is already routed. */
  d1: Map<string, number>;
  /** Distance for a packet that still has to cross a layer 3 device. */
  d0: Map<string, number>;
}

export class Routing {
  private tables = new Map<string, Table>();
  private readonly net: Network;
  private readonly isUp: (id: string) => boolean;

  constructor(net: Network, isUp: (id: string) => boolean) {
    this.net = net;
    this.isUp = isUp;
  }

  invalidate(): void {
    this.tables.clear();
  }

  linkUp(l: NetLink): boolean {
    return !l.broken && this.isUp(l.a) && this.isUp(l.b);
  }

  private table(dst: string): Table {
    let t = this.tables.get(dst);
    if (!t) {
      t = this.compute(dst);
      this.tables.set(dst, t);
    }
    return t;
  }

  private compute(dst: string): Table {
    const d1 = new Map<string, number>();
    const d0 = new Map<string, number>();
    if (!this.net.byId.has(dst) || !this.isUp(dst)) return { d1, d0 };

    // d1: breadth-first search from the destination, only through active devices.
    d1.set(dst, 0);
    const queue = [dst];
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      const dn = d1.get(n)!;
      for (const l of this.net.adj.get(n) ?? []) {
        if (!this.linkUp(l)) continue;
        const m = otherEnd(l, n);
        if (d1.has(m)) continue;
        d1.set(m, dn + 1);
        if (this.net.byId.get(m)!.transit) queue.push(m);
      }
    }

    // d0: shortest path to a layer 3 device (which routes the packet), then d1 from that device.
    const best = new Map<string, number>();
    const buckets: string[][] = [];
    const offer = (id: string, d: number) => {
      if (id === dst) return;
      const node = this.net.byId.get(id)!;
      if (node.l3) return;
      const cur = best.get(id);
      if (cur !== undefined && cur <= d) return;
      best.set(id, d);
      (buckets[d] ??= []).push(id);
    };
    for (const node of this.net.nodes) {
      if (!node.l3 || !node.transit || !this.isUp(node.id)) continue;
      const dm = d1.get(node.id);
      if (dm === undefined) continue;
      for (const l of this.net.adj.get(node.id) ?? []) {
        if (this.linkUp(l)) offer(otherEnd(l, node.id), dm + 1);
      }
    }
    for (let d = 0; d < buckets.length; d++) {
      const bucket = buckets[d];
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const id = bucket[i];
        if (best.get(id) !== d || d0.has(id)) continue;
        d0.set(id, d);
        if (!this.net.byId.get(id)!.transit) continue;
        for (const l of this.net.adj.get(id) ?? []) {
          if (this.linkUp(l)) offer(otherEnd(l, id), d + 1);
        }
      }
    }
    return { d1, d0 };
  }

  distance(from: string, dst: string, routed: boolean): number {
    if (from === dst) return 0;
    const t = this.table(dst);
    return (routed ? t.d1.get(from) : t.d0.get(from)) ?? Infinity;
  }

  /** Candidate links (equal cost) to move towards the destination. */
  nextHops(at: string, dst: string, routed: boolean): NetLink[] {
    const t = this.table(dst);
    const cur = routed ? t.d1.get(at) : t.d0.get(at);
    if (cur === undefined) return [];
    const out: NetLink[] = [];
    for (const l of this.net.adj.get(at) ?? []) {
      if (!this.linkUp(l)) continue;
      const m = otherEnd(l, at);
      if (m === dst) {
        if (routed && cur === 1) out.push(l);
        continue;
      }
      const node = this.net.byId.get(m)!;
      if (!node.transit) continue;
      const r2 = routed || node.l3;
      const dm = r2 ? t.d1.get(m) : t.d0.get(m);
      if (dm !== undefined && dm + 1 === cur) out.push(l);
    }
    return out;
  }

  /** Deterministic path (first candidate), for ping/traceroute. */
  path(src: string, dst: string, routed: boolean): string[] | null {
    if (this.distance(src, dst, routed) === Infinity) return null;
    const out = [src];
    let at = src;
    let r = routed;
    for (let guard = 0; guard < 256 && at !== dst; guard++) {
      const hops = this.nextHops(at, dst, r).sort((p, q) => cmp(p.id, q.id));
      if (hops.length === 0) return null;
      at = otherEnd(hops[0], at);
      if (this.net.byId.get(at)!.l3) r = true;
      out.push(at);
    }
    return at === dst ? out : null;
  }
}
