// Worker thread entry: replays runs sent by the main thread.

import { parentPort } from 'node:worker_threads';
import { verifyNow, type Verdict } from './verify.ts';

parentPort!.on('message', (msg: { id: number; raw: unknown }) => {
  let verdict: Verdict;
  try {
    verdict = verifyNow(msg.raw);
  } catch (e) {
    console.error('[verify] replay crashed:', e);
    verdict = { ok: false, reason: 'error' };
  }
  parentPort!.postMessage({ id: msg.id, verdict });
});
