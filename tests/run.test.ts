import { describe, expect, it } from 'vitest';
import { playDay } from '../src/core/headless.ts';
import { CAMPAIGN, levelById } from '../src/core/levels.ts';
import { recordRun, replayRun, SIM_VERSION, validateRun, type RunRecord } from '../src/core/run.ts';
import { MAX_MISSION_SCORE, missionScore, nextTier, tierFor } from '../src/core/score.ts';
import { buildSolution, SOLUTIONS } from './solutions.ts';

function referenceRun(id: string): { run: RunRecord; total: number } {
  const level = levelById(id)!;
  const sol = SOLUTIONS[id](level);
  const built = buildSolution(level, sol);
  const { sim, result } = playDay(level, built.design, built.config, { script: sol.script });
  return { run: recordRun(level, built.design, sim), total: missionScore(level, result).total };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('run records', () => {
  for (const level of CAMPAIGN) {
    it(`${level.company}: a recorded day replays to the same score`, () => {
      const { run, total } = referenceRun(level.id);
      const valid = validateRun(clone(run));
      expect(typeof valid).not.toBe('string');
      const replay = replayRun(valid as RunRecord);
      expect(replay.result.success).toBe(true);
      expect(replay.score.total).toBe(total);
    });
  }

  it('records live actions with their step', () => {
    const { run } = referenceRun('helios');
    expect(run.actions.some((a) => a.kind === 'dispatch')).toBe(true);
    expect(run.actions.some((a) => a.kind === 'config')).toBe(true);
    const ticks = run.actions.map((a) => a.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  it('refuses forged or inconsistent records', () => {
    const { run } = referenceRun('shopnow');
    const bad = (mutate: (r: RunRecord) => void) => {
      const r = clone(run);
      mutate(r);
      return validateRun(r);
    };
    expect(bad((r) => (r.v = SIM_VERSION + 1))).toMatch(/version/);
    expect(bad((r) => (r.level = 'training'))).toMatch(/level/);
    expect(bad((r) => r.design.devices.push({ id: 'rt-9', kind: 'router_pro', x: 1, y: 1 }))).toMatch(/budget|overlap/);
    expect(bad((r) => (r.design.devices[0].x = 999))).toMatch(/position/);
    expect(bad((r) => r.design.cables.push({ id: 'c999', a: 'pc-1', b: 'pc-2', kind: 'rj45' }))).toMatch(/endpoint|ports/);
    expect(bad((r) => r.skills.push('router_pro'))).toMatch(/prerequisites/);
    expect(bad((r) => (r.config.vlans.staff = 20))).toMatch(/vlan feature/);
    expect(bad((r) => (r.config.quarantine = ['pc-1']))).toMatch(/quarantine/);
    expect(bad((r) => (r.actions[0].tick = -5))).toMatch(/tick/);
    expect(validateRun('nope')).toMatch(/record/);
  });
});

describe('score and tiers', () => {
  it('rewards successful days only, within the maximum', () => {
    const level = levelById('pixelbrew')!;
    const lost = missionScore(level, { success: false, stars: 0, objectives: [], starRules: [], failReason: 'x', spent: 0, avgFrustration: 0, peakFrustration: 0, lossRate: 0, transactions: 0 });
    expect(lost.total).toBe(0);
    const perfect = missionScore(level, { success: true, stars: 3, objectives: [], starRules: [], failReason: '', spent: 0, avgFrustration: 0, peakFrustration: 0, lossRate: 0, transactions: 100 });
    expect(perfect.total).toBe(MAX_MISSION_SCORE);
  });

  it('maps totals to tiers', () => {
    expect(tierFor(0).id).toBe('unranked');
    expect(tierFor(1500).id).toBe('bronze');
    expect(tierFor(12500).id).toBe('diamond');
    expect(tierFor(14000).id).toBe('legend');
    expect(nextTier(14000)).toBeNull();
    expect(nextTier(0)!.tier.id).toBe('bronze');
  });
});
