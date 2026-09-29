// Catalog: hardware, cables and traffic types.
// Internal throughput unit: "u/s". 30 u/s = 1 Gb/s. A packet of size 1 ≈ 33 Mb.
// Display names are getters on the current dictionary, so they follow the language.

import { num, T } from '../i18n/index.ts';
import type { CableKind, EquipmentKind, Proto, SkillId, TrafficKind } from './types.ts';

export { euros } from '../i18n/index.ts';

export const UNITS_PER_GBPS = 30;
/** One grid cell = 5 meters. */
export const METERS_PER_CELL = 5;

export interface DeviceSpec {
  kind: EquipmentKind;
  readonly name: string;
  /** Short name for the toolbar. */
  readonly short: string;
  prefix: string;
  cost: number;
  ports: number;
  /** Switching/routing throughput in u/s. */
  capacity: number;
  queue: number;
  l3: boolean;
  nat: boolean;
  heat: number;
  wifi?: { radius: number; clients: number };
  skill?: SkillId;
  readonly desc: string;
}

type DeviceData = Omit<DeviceSpec, 'name' | 'short' | 'desc'>;

function device(d: DeviceData): DeviceSpec {
  return {
    ...d,
    get name() {
      return T.catalog.devices[d.kind].name;
    },
    get short() {
      return T.catalog.devices[d.kind].short;
    },
    get desc() {
      return T.catalog.devices[d.kind].desc;
    },
  };
}

export const DEVICES: Record<EquipmentKind, DeviceSpec> = {
  switch8: device({
    kind: 'switch8',
    prefix: 'SW',
    cost: 250,
    ports: 8,
    capacity: 60,
    queue: 40,
    l3: false,
    nat: false,
    heat: 1.0,
  }),
  switch24: device({
    kind: 'switch24',
    prefix: 'SW',
    cost: 650,
    ports: 24,
    capacity: 150,
    queue: 80,
    l3: false,
    nat: false,
    heat: 1.1,
  }),
  switch_l3: device({
    kind: 'switch_l3',
    prefix: 'L3',
    cost: 1500,
    ports: 24,
    capacity: 330,
    queue: 140,
    l3: true,
    nat: false,
    heat: 1.1,
    skill: 'switch_l3',
  }),
  router: device({
    kind: 'router',
    prefix: 'RT',
    cost: 700,
    ports: 4,
    capacity: 75,
    queue: 60,
    l3: true,
    nat: true,
    heat: 1.25,
  }),
  router_pro: device({
    kind: 'router_pro',
    prefix: 'RT',
    cost: 1900,
    ports: 8,
    capacity: 240,
    queue: 140,
    l3: true,
    nat: true,
    heat: 1.2,
    skill: 'router_pro',
  }),
  ap: device({
    kind: 'ap',
    prefix: 'AP',
    cost: 220,
    ports: 1,
    capacity: 24,
    queue: 30,
    l3: false,
    nat: false,
    heat: 0.9,
    wifi: { radius: 6.5, clients: 8 },
  }),
};

export const EQUIPMENT_ORDER: EquipmentKind[] = ['switch8', 'switch24', 'router', 'ap', 'switch_l3', 'router_pro'];

export interface CableSpec {
  kind: CableKind;
  readonly name: string;
  readonly short: string;
  /** Toolbar label, e.g. "Fiber". */
  readonly tool: string;
  capacity: number;
  base: number;
  perCell: number;
  maxLen: number;
  speed: number;
  skill?: SkillId;
}

type CableData = Omit<CableSpec, 'name' | 'short' | 'tool'>;

function cable(c: CableData): CableSpec {
  return {
    ...c,
    get name() {
      return T.catalog.cables[c.kind].name;
    },
    get short() {
      return T.catalog.cables[c.kind].short;
    },
    get tool() {
      return T.catalog.cables[c.kind].tool;
    },
  };
}

export const CABLES: Record<CableKind, CableSpec> = {
  rj45: cable({
    kind: 'rj45',
    capacity: 30,
    base: 20,
    perCell: 5,
    maxLen: 20,
    speed: 7,
  }),
  fiber: cable({
    kind: 'fiber',
    capacity: 300,
    base: 120,
    perCell: 12,
    maxLen: 100,
    speed: 9,
    skill: 'fiber',
  }),
};

export const WIFI_LINK = { capacity: 15, speed: 6 };

export const SERVER_DEFAULTS = { capacity: 20, queue: 40, ports: 2, heat: 1.0 };
export const INTERNET_DEFAULTS = { isp: 90, ports: 2 };

export interface TrafficSpec {
  kind: TrafficKind;
  readonly label: string;
  color: string;
  proto: Proto;
  port: number;
  reqSize: number;
  respSize: number;
  legit: boolean;
}

function traffic(t: Omit<TrafficSpec, 'label'>): TrafficSpec {
  return {
    ...t,
    get label() {
      return T.catalog.traffic[t.kind];
    },
  };
}

export const TRAFFIC: Record<TrafficKind, TrafficSpec> = {
  web: traffic({ kind: 'web', color: '#3aa0ff', proto: 'tcp', port: 443, reqSize: 1, respSize: 2, legit: true }),
  stream: traffic({ kind: 'stream', color: '#b26cff', proto: 'udp', port: 443, reqSize: 1, respSize: 4, legit: true }),
  data: traffic({ kind: 'data', color: '#35e3a0', proto: 'tcp', port: 445, reqSize: 1, respSize: 3, legit: true }),
  customer: traffic({ kind: 'customer', color: '#8fd3ff', proto: 'tcp', port: 443, reqSize: 1, respSize: 2, legit: true }),
  probe: traffic({ kind: 'probe', color: '#ffab3d', proto: 'tcp', port: 445, reqSize: 1, respSize: 0, legit: false }),
  attack: traffic({ kind: 'attack', color: '#ff3355', proto: 'udp', port: 123, reqSize: 1, respSize: 0, legit: false }),
  worm: traffic({ kind: 'worm', color: '#ff3355', proto: 'tcp', port: 445, reqSize: 1, respSize: 0, legit: false }),
};

/** Color of blocked or lost packets. */
export const BLOCKED_COLOR = '#ff3355';

/** Cooling per room type: the server room is air-conditioned. */
export const ROOM_COOLING: Record<string, number> = {
  office: 0.1,
  meeting: 0.1,
  lobby: 0.1,
  it: 0.1,
  server: 0.17,
  corridor: 0.1,
};

export const HEAT = {
  gain: 0.12,
  overheat: 1,
  restart: 0.5,
  coolingSkill: 1.35,
};

export function tempCelsius(heat: number): number {
  return Math.round(30 + heat * 55);
}

export function gbps(units: number): string {
  const v = units / UNITS_PER_GBPS;
  return `${num(v, v >= 10 ? 0 : 1)} Gb/s`;
}

export function meters(cells: number): string {
  return `${Math.round(cells * METERS_PER_CELL)} m`;
}

export function cableCost(kind: CableKind, lengthCells: number): number {
  const spec = CABLES[kind];
  return spec.base + spec.perCell * Math.max(1, Math.round(lengthCells));
}
