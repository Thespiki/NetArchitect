// Score verification: the server replays the player's day with the same simulation as the game.
// Replays run in a worker thread (a day takes 50–300 ms of CPU) so that other requests are not held up.

import { Worker } from 'node:worker_threads';
import { replayRun, validateRun, type RunRecord } from '../src/core/run.ts';
import type { ScoreBreakdown } from '../src/core/score.ts';

export type Verdict =
  | {
      ok: true;
      run: RunRecord;
      score: ScoreBreakdown;
      stars: number;
      metrics: { avgFrustration: number; lossRate: number; spent: number };
    }
  | { ok: false; reason: string };

/** Replays a run in this thread. */
export function verifyNow(raw: unknown): Verdict {
  const run = validateRun(raw);
  if (typeof run === 'string') return { ok: false, reason: run };
  const { result, score } = replayRun(run);
  if (!result.success) return { ok: false, reason: 'failed' };
  return {
    ok: true,
    run,
    score,
    stars: result.stars,
    metrics: { avgFrustration: result.avgFrustration, lossRate: result.lossRate, spent: result.spent },
  };
}

export interface Verifier {
  verify(raw: unknown): Promise<Verdict>;
  close(): Promise<void>;
}

export function inlineVerifier(): Verifier {
  return {
    verify: async (raw) => verifyNow(raw),
    close: async () => {},
  };
}

interface Job {
  id: number;
  raw: unknown;
  resolve: (v: Verdict) => void;
  timer?: NodeJS.Timeout;
}

/** One worker, one job at a time, a bounded queue and a watchdog. */
export function workerVerifier(opts: { maxQueue?: number; timeoutMs?: number } = {}): Verifier {
  const maxQueue = opts.maxQueue ?? 40;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const queue: Job[] = [];
  let current: Job | null = null;
  let worker: Worker | null = null;
  let seq = 0;
  let closed = false;

  const spawn = () => {
    const w = new Worker(new URL('./verify-worker.ts', import.meta.url));
    w.on('message', (msg: { id: number; verdict: Verdict }) => {
      if (!current || msg.id !== current.id) return;
      clearTimeout(current.timer);
      current.resolve(msg.verdict);
      current = null;
      next();
    });
    w.on('error', (err) => {
      console.error('[verify] worker error:', err);
      fail('error');
    });
    w.on('exit', () => {
      if (worker === w) worker = null;
      if (current) fail('error');
    });
    worker = w;
    return w;
  };

  const fail = (reason: string) => {
    if (!current) return;
    clearTimeout(current.timer);
    current.resolve({ ok: false, reason });
    current = null;
    next();
  };

  const next = () => {
    if (current || closed) return;
    const job = queue.shift();
    if (!job) return;
    current = job;
    job.timer = setTimeout(() => {
      console.error('[verify] replay timed out, restarting the worker');
      const w = worker;
      worker = null;
      void w?.terminate();
      fail('timeout');
    }, timeoutMs);
    (worker ?? spawn()).postMessage({ id: job.id, raw: job.raw });
  };

  return {
    verify(raw) {
      if (closed) return Promise.resolve({ ok: false, reason: 'closed' });
      if (queue.length >= maxQueue) return Promise.resolve({ ok: false, reason: 'busy' });
      return new Promise<Verdict>((resolve) => {
        queue.push({ id: ++seq, raw, resolve });
        next();
      });
    },
    async close() {
      closed = true;
      for (const j of queue.splice(0)) j.resolve({ ok: false, reason: 'closed' });
      await worker?.terminate();
    },
  };
}
