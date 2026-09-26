// In-memory rate limiting (fixed windows). Enough for a single game server.

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Counts one hit; false when the limit is exceeded. */
  take(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(now);
      return true;
    }
    cur.count++;
    return cur.count <= this.max;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}
