import { describe, expect, it } from 'vitest';
import {
  autoCable,
  brokenCables,
  canConnect,
  connect,
  designCost,
  emptyDesign,
  moveDevice,
  placeDevice,
  portsUsed,
  removeDevice,
} from '../src/core/design.ts';
import { levelById } from '../src/core/levels.ts';
import { buildNetwork } from '../src/core/network.ts';
import type { SkillId } from '../src/core/types.ts';
import { miniLevel } from './helpers.ts';

const none = new Set<SkillId>();

describe('pose et câblage', () => {
  it('numérote le matériel et refuse les cases occupées', () => {
    const lvl = miniLevel();
    const d = emptyDesign();
    expect(placeDevice(lvl, d, 'switch8', 5, 5, none)).toMatchObject({ id: 'sw-1' });
    expect(placeDevice(lvl, d, 'switch24', 6, 5, none)).toMatchObject({ id: 'sw-2' });
    expect(placeDevice(lvl, d, 'router', 5, 5, none)).toBe('Emplacement déjà occupé.');
    expect(placeDevice(lvl, d, 'router', 2, 2, none)).toBe('Emplacement déjà occupé.');
  });

  it('applique les règles de câblage', () => {
    const lvl = miniLevel();
    const d = emptyDesign();
    placeDevice(lvl, d, 'switch8', 5, 5, none);
    placeDevice(lvl, d, 'router', 27, 5, none);
    placeDevice(lvl, d, 'ap', 13, 6, none);
    const reason = (a: string, b: string, kind: 'rj45' | 'fiber' = 'rj45') => {
      const c = canConnect(lvl, d, a, b, kind, none);
      return c.ok ? 'ok' : c.reason;
    };
    expect(reason('a1', 'a2')).toMatch(/pas directement entre eux/);
    expect(reason('lap', 'sw-1')).toMatch(/Wi-Fi/);
    expect(reason('net', 'sw-1')).toMatch(/routeur \(NAT\)/);
    expect(reason('net', 'rt-1')).toBe('ok');
    expect(reason('ap-1', 'b1')).toMatch(/lien montant/);
    expect(reason('sw-1', 'rt-1')).toMatch(/Trop long/);
    expect(reason('sw-1', 'rt-1', 'fiber')).toBe('ok');
  });

  it('refuse le matériel verrouillé et le dépassement de budget', () => {
    const lvl = levelById('pixelbrew')!;
    const d = emptyDesign();
    expect(placeDevice(lvl, d, 'switch_l3', 5, 5, none)).toMatch(/pas encore débloqué/);
    expect(placeDevice(lvl, d, 'switch_l3', 5, 5, new Set<SkillId>(['switch_l3']))).toMatchObject({ kind: 'switch_l3' });
    expect(placeDevice(lvl, d, 'router', 6, 5, none)).toMatch(/Budget insuffisant/);
  });

  it('limite les ports', () => {
    const lvl = miniLevel();
    const d = emptyDesign();
    placeDevice(lvl, d, 'router', 20, 5, none);
    placeDevice(lvl, d, 'switch8', 18, 5, none);
    for (let i = 0; i < 4; i++) connect(lvl, d, 'rt-1', 'sw-1', 'rj45', none);
    const c = canConnect(lvl, d, 'rt-1', 'sw-1', 'rj45', none);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toMatch(/plus de port libre \(4\/4\)/);
  });

  it('câble automatiquement les postes de la pièce du switch', () => {
    const lvl = miniLevel();
    const d = emptyDesign();
    placeDevice(lvl, d, 'switch8', 3, 5, none);
    expect(autoCable(lvl, d, 'sw-1', none)).toBe(2);
    expect(portsUsed(d, 'a1')).toBe(1);
    expect(portsUsed(d, 'b1')).toBe(0);
    expect(portsUsed(d, 'db')).toBe(0);
  });

  it('calcule le coût et détecte les câbles devenus trop longs', () => {
    const lvl = miniLevel();
    const d = emptyDesign();
    placeDevice(lvl, d, 'switch8', 5, 2, none);
    connect(lvl, d, 'sw-1', 'a1', 'rj45', none);
    expect(designCost(lvl, d)).toBe(250 + 20 + 5 * 3);
    moveDevice(lvl, d, 'sw-1', 27, 10);
    expect(brokenCables(lvl, d).size).toBe(1);
    expect(buildNetwork(lvl, d).adj.get('a1')).toEqual([]);
    removeDevice(d, 'sw-1');
    expect(d.cables).toEqual([]);
  });
});

describe('Wi-Fi', () => {
  it('associe les portables à la borne la plus proche et signale les zones blanches', () => {
    const lvl = miniLevel();
    const d = emptyDesign();
    expect(buildNetwork(lvl, d).uncovered).toEqual(['lap']);
    placeDevice(lvl, d, 'ap', 13, 6, none);
    const net = buildNetwork(lvl, d);
    expect(net.uncovered).toEqual([]);
    expect(net.wifiClients.get('ap-1')).toEqual(['lap']);
  });
});
