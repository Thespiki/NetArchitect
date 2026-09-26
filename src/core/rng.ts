// Générateur pseudo-aléatoire déterministe (mulberry32) : une même graine rejoue la même journée.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Tirage pondéré : renvoie la clé choisie. */
  weighted<K extends string>(weights: Partial<Record<K, number>>): K | null {
    let total = 0;
    for (const k in weights) total += weights[k] ?? 0;
    if (total <= 0) return null;
    let r = this.next() * total;
    let last: K | null = null;
    for (const k in weights) {
      const w = weights[k] ?? 0;
      if (w <= 0) continue;
      last = k;
      r -= w;
      if (r <= 0) return k;
    }
    return last;
  }
}
