// Engine-independent math. Math.exp and Math.hypot may differ in the last bit from one JavaScript
// engine to another, which would make a replayed day drift apart. Additions, multiplications,
// divisions and Math.sqrt are exact (IEEE 754) everywhere, so these helpers only use those.

const LN2 = 0.6931471805599453;

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  // Taylor series on |r| ≤ ln 2 / 2: 22 terms reach full double precision.
  let term = 1;
  let sum = 1;
  for (let i = 1; i < 22; i++) {
    term = (term * r) / i;
    sum += term;
  }
  const base = k < 0 ? 0.5 : 2;
  for (let i = Math.abs(k); i > 0; i--) sum *= base;
  return sum;
}

export function dist(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Ordinal string comparison (localeCompare depends on the platform's collation rules). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
