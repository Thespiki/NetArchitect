import { describe, expect, it } from 'vitest';
import { defaultConfig, type NetConfig } from '../src/core/config.ts';
import { execute, type ConsoleHost } from '../src/core/console.ts';
import { emptyDesign } from '../src/core/design.ts';
import type { LevelDef } from '../src/core/level.ts';
import { levelById } from '../src/core/levels.ts';
import { buildNetwork } from '../src/core/network.ts';
import type { SkillId } from '../src/core/types.ts';
import { setLang } from '../src/i18n/index.ts';
import { buildSolution, SOLUTIONS } from './solutions.ts';

function host(level: LevelDef, skills: SkillId[] = []): ConsoleHost & { cfg: NetConfig } {
  const built = SOLUTIONS[level.id] ? buildSolution(level, { ...SOLUTIONS[level.id](level), configure: [] }) : null;
  const design = built?.design ?? emptyDesign();
  const net = buildNetwork(level, design);
  const h = {
    cfg: defaultConfig(level),
    level,
    skills: new Set(skills),
    phase: () => 'config' as const,
    network: () => net,
    config: () => h.cfg,
    setConfig: (c: NetConfig) => (h.cfg = c),
    sim: () => null,
    issues: () => [],
  };
  return h;
}

const text = (lines: { text: string }[]) => lines.map((l) => l.text).join('\n');

describe('console', () => {
  it('sets VLANs, subnets and rules', () => {
    const h = host(levelById('bionova')!);
    expect(text(execute('vlan acct 10', h))).toMatch(/Accounting → VLAN 10/);
    expect(h.cfg.vlans.acct).toBe(10);
    execute('vlan compta 11', h);
    expect(h.cfg.vlans.acct).toBe(11);
    execute('vlan acct 10', h);
    expect(text(execute('subnet 10 10.42.0.16/29', h))).toMatch(/10\.42\.0\.16\/29/);
    expect(execute('subnet 10 10.42.0.20/29', h)[0].tone).toBe('err');
    execute('fw deny acct labdata', h);
    execute('block udp 123', h);
    expect(h.cfg.rules.map((r) => r.src)).toEqual(['any', 'acct']);
    execute('fw del 1', h);
    expect(h.cfg.rules).toHaveLength(1);
  });

  it('refuses mechanics that are not unlocked yet', () => {
    const h = host(levelById('pixelbrew')!);
    expect(execute('vlan team 10', h)[0].tone).toBe('err');
    expect(execute('lb nas rr', h)[0].tone).toBe('err');
    expect(execute('ratelimit tcp/443 50', h)[0].text).toMatch(/Skill required/);
    expect(execute('top', h)[0].text).toMatch(/during the simulation/);
    expect(execute('xyzzy', h)[0].text).toMatch(/Unknown command/);
  });

  it('ping and traceroute explain the verdict', () => {
    const h = host(levelById('bionova')!);
    for (const cmd of ['vlan rnd 20', 'vlan acct 10', 'vlan srv 99', 'subnet 20 10.42.0.0/28', 'subnet 10 10.42.0.16/29', 'subnet 99 10.42.0.24/29']) {
      execute(cmd, h);
    }
    expect(text(execute('ping acct labdata tcp/445', h))).toMatch(/Reachable/);
    execute('fw deny acct labdata', h);
    const out = execute('traceroute acct labdata tcp/445', h);
    expect(out.at(-1)!.tone).toBe('err');
    expect(text(out)).toMatch(/Blocked by RT-1, rule #1/);
    expect(text(execute('ping rnd internet', h))).toMatch(/Reachable/);
  });

  it('speaks French when the language changes', () => {
    const h = host(levelById('bionova')!);
    setLang('fr');
    try {
      expect(text(execute('vlan compta 10', h))).toMatch(/Comptabilité → VLAN 10/);
      expect(execute('xyzzy', h)[0].text).toMatch(/Commande inconnue/);
    } finally {
      setLang('en');
    }
  });

  it('Auto-VLAN script (skill)', () => {
    const h = host(levelById('bionova')!, ['autovlan']);
    execute('autovlan', h);
    expect(new Set(Object.values(h.cfg.vlans)).size).toBe(3);
    expect(Object.keys(h.cfg.subnets)).toHaveLength(3);
  });
});
