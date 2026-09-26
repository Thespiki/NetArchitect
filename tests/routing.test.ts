import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.ts';
import { connect, emptyDesign, placeDevice, type Design } from '../src/core/design.ts';
import { probe } from '../src/core/diagnostics.ts';
import { buildNetwork } from '../src/core/network.ts';
import { Routing } from '../src/core/routing.ts';
import type { SkillId } from '../src/core/types.ts';
import { miniLevel } from './helpers.ts';

const none = new Set<SkillId>();
const lvl = miniLevel();

/** a1, a2, b1 sur SW-1 ; routeur RT-1 relié à SW-1, à la base de données et au FAI. */
function star(withRouter = true): Design {
  const d = emptyDesign();
  placeDevice(lvl, d, 'switch24', 9, 6, none);
  for (const id of ['a1', 'a2', 'b1']) connect(lvl, d, 'sw-1', id, 'rj45', none);
  if (withRouter) {
    placeDevice(lvl, d, 'router', 21, 6, none);
    connect(lvl, d, 'sw-1', 'rt-1', 'rj45', none);
    connect(lvl, d, 'rt-1', 'db', 'rj45', none);
    connect(lvl, d, 'rt-1', 'net', 'rj45', none);
  } else {
    connect(lvl, d, 'sw-1', 'db', 'fiber', none);
  }
  return d;
}

describe('routage', () => {
  it('commute le trafic d’un même VLAN sans passer par le routeur', () => {
    const net = buildNetwork(lvl, star());
    const r = new Routing(net, () => true);
    expect(r.path('a1', 'b1', true)).toEqual(['a1', 'sw-1', 'b1']);
  });

  it('impose un niveau 3 entre deux VLAN', () => {
    const cfg = { ...defaultConfig(lvl), vlans: { ga: 10, gb: 20, srv: 99 } };
    const flat = probe(lvl, buildNetwork(lvl, star(false)), cfg, 'a1', 'db');
    expect(flat.ok).toBe(false);
    expect(flat.lines.at(-1)).toMatch(/aucun équipement de niveau 3/);
    const routed = probe(lvl, buildNetwork(lvl, star()), cfg, 'a1', 'db');
    expect(routed.ok).toBe(true);
    expect(routed.path).toEqual(['a1', 'sw-1', 'rt-1', 'db']);
  });

  it('ne filtre que le trafic routé', () => {
    const net = buildNetwork(lvl, star());
    const deny = { id: 1, action: 'deny' as const, src: 'ga', dst: 'db', proto: 'any' as const, port: null };
    const flat = { ...defaultConfig(lvl), rules: [deny] };
    expect(probe(lvl, net, flat, 'a1', 'db').ok).toBe(true);
    const split = { ...flat, vlans: { ga: 10, gb: 20, srv: 99 } };
    const res = probe(lvl, net, split, 'a1', 'db');
    expect(res.ok).toBe(false);
    expect(res.blockedAt).toBe('rt-1');
    expect(probe(lvl, net, split, 'b1', 'db').ok).toBe(true);
  });

  it('répartit sur les liens parallèles (ECMP)', () => {
    const d = star();
    connect(lvl, d, 'sw-1', 'rt-1', 'rj45', none);
    const net = buildNetwork(lvl, d);
    const r = new Routing(net, () => true);
    expect(r.nextHops('sw-1', 'net', false)).toHaveLength(2);
  });

  it('contourne un équipement en panne par le chemin redondant', () => {
    const d = star();
    placeDevice(lvl, d, 'switch8', 9, 8, none);
    connect(lvl, d, 'sw-2', 'rt-1', 'rj45', none);
    connect(lvl, d, 'sw-2', 'sw-1', 'rj45', none);
    const net = buildNetwork(lvl, d);
    let down = new Set<string>();
    const r = new Routing(net, (id) => !down.has(id));
    expect(r.path('sw-1', 'db', true)).toEqual(['sw-1', 'rt-1', 'db']);
    down = new Set(['rt-1']);
    r.invalidate();
    expect(r.path('sw-1', 'db', true)).toBeNull();
    down = new Set();
    r.invalidate();
    const cables = d.cables.filter((c) => !(c.a === 'sw-1' && c.b === 'rt-1'));
    const net2 = buildNetwork(lvl, { ...d, cables });
    const r2 = new Routing(net2, () => true);
    expect(r2.path('a1', 'db', false)).toEqual(['a1', 'sw-1', 'sw-2', 'rt-1', 'db']);
  });
});
