// Catalogue : matériel, câbles et types de trafic.
// Unité interne de débit : « u/s ». 30 u/s = 1 Gb/s. Un paquet de taille 1 ≈ 33 Mb.

import type { CableKind, EquipmentKind, Proto, SkillId, TrafficKind } from './types.ts';

export const UNITS_PER_GBPS = 30;
/** Un pas de grille = 5 mètres. */
export const METERS_PER_CELL = 5;

export interface DeviceSpec {
  kind: EquipmentKind;
  name: string;
  prefix: string;
  cost: number;
  ports: number;
  /** Débit de commutation/routage en u/s. */
  capacity: number;
  queue: number;
  l3: boolean;
  nat: boolean;
  heat: number;
  wifi?: { radius: number; clients: number };
  skill?: SkillId;
  desc: string;
}

export const DEVICES: Record<EquipmentKind, DeviceSpec> = {
  switch8: {
    kind: 'switch8',
    name: 'Switch 8 ports',
    prefix: 'SW',
    cost: 250,
    ports: 8,
    capacity: 60,
    queue: 40,
    l3: false,
    nat: false,
    heat: 1.0,
    desc: 'Switch de niveau 2. Relie les postes d’un même VLAN.',
  },
  switch24: {
    kind: 'switch24',
    name: 'Switch 24 ports',
    prefix: 'SW',
    cost: 650,
    ports: 24,
    capacity: 150,
    queue: 80,
    l3: false,
    nat: false,
    heat: 1.1,
    desc: 'Switch d’étage de niveau 2, plus de ports et un fond de panier plus large.',
  },
  switch_l3: {
    kind: 'switch_l3',
    name: 'Switch niveau 3',
    prefix: 'L3',
    cost: 1500,
    ports: 24,
    capacity: 330,
    queue: 140,
    l3: true,
    nat: false,
    heat: 1.1,
    skill: 'switch_l3',
    desc: 'Route entre VLAN et applique le pare-feu à pleine vitesse. Pas de NAT vers Internet.',
  },
  router: {
    kind: 'router',
    name: 'Routeur PME',
    prefix: 'RT',
    cost: 700,
    ports: 4,
    capacity: 75,
    queue: 60,
    l3: true,
    nat: true,
    heat: 1.25,
    desc: 'Route entre VLAN, filtre (pare-feu) et partage l’accès Internet (NAT).',
  },
  router_pro: {
    kind: 'router_pro',
    name: 'Routeur haute capacité',
    prefix: 'RT',
    cost: 1900,
    ports: 8,
    capacity: 240,
    queue: 140,
    l3: true,
    nat: true,
    heat: 1.2,
    skill: 'router_pro',
    desc: 'Routeur de cœur de réseau : trois fois le débit du modèle PME.',
  },
  ap: {
    kind: 'ap',
    name: 'Borne Wi-Fi',
    prefix: 'AP',
    cost: 220,
    ports: 1,
    capacity: 24,
    queue: 30,
    l3: false,
    nat: false,
    heat: 0.9,
    wifi: { radius: 6.5, clients: 8 },
    desc: 'Connecte les portables à portée (≈ 30 m). Le débit radio est partagé.',
  },
};

export const EQUIPMENT_ORDER: EquipmentKind[] = ['switch8', 'switch24', 'router', 'ap', 'switch_l3', 'router_pro'];

export interface CableSpec {
  kind: CableKind;
  name: string;
  short: string;
  capacity: number;
  base: number;
  perCell: number;
  maxLen: number;
  speed: number;
  skill?: SkillId;
}

export const CABLES: Record<CableKind, CableSpec> = {
  rj45: {
    kind: 'rj45',
    name: 'Câble RJ45 Cat6',
    short: 'RJ45 · 1 Gb/s',
    capacity: 30,
    base: 20,
    perCell: 5,
    maxLen: 20,
    speed: 7,
  },
  fiber: {
    kind: 'fiber',
    name: 'Fibre optique OM4',
    short: 'Fibre · 10 Gb/s',
    capacity: 300,
    base: 120,
    perCell: 12,
    maxLen: 100,
    speed: 9,
    skill: 'fiber',
  },
};

export const WIFI_LINK = { capacity: 15, speed: 6 };

export const SERVER_DEFAULTS = { capacity: 20, queue: 40, ports: 2, heat: 1.0 };
export const INTERNET_DEFAULTS = { isp: 90, ports: 2 };

export interface TrafficSpec {
  kind: TrafficKind;
  label: string;
  color: string;
  proto: Proto;
  port: number;
  reqSize: number;
  respSize: number;
  legit: boolean;
}

export const TRAFFIC: Record<TrafficKind, TrafficSpec> = {
  web: { kind: 'web', label: 'Navigation web', color: '#3aa0ff', proto: 'tcp', port: 443, reqSize: 1, respSize: 2, legit: true },
  stream: { kind: 'stream', label: 'Streaming vidéo', color: '#b26cff', proto: 'udp', port: 443, reqSize: 1, respSize: 4, legit: true },
  data: { kind: 'data', label: 'Fichiers et applis internes', color: '#35e3a0', proto: 'tcp', port: 445, reqSize: 1, respSize: 3, legit: true },
  customer: { kind: 'customer', label: 'Clients e-commerce', color: '#8fd3ff', proto: 'tcp', port: 443, reqSize: 1, respSize: 2, legit: true },
  probe: { kind: 'probe', label: 'Sonde d’audit', color: '#ffab3d', proto: 'tcp', port: 445, reqSize: 1, respSize: 0, legit: false },
  attack: { kind: 'attack', label: 'Trafic malveillant', color: '#ff3355', proto: 'udp', port: 123, reqSize: 1, respSize: 0, legit: false },
  worm: { kind: 'worm', label: 'Ver informatique', color: '#ff3355', proto: 'tcp', port: 445, reqSize: 1, respSize: 0, legit: false },
};

/** Couleur des paquets bloqués ou perdus. */
export const BLOCKED_COLOR = '#ff3355';

/** Refroidissement par type de pièce : la salle serveurs est climatisée. */
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
  const digits = v >= 10 ? 0 : 1;
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} Gb/s`;
}

export function meters(cells: number): string {
  return `${Math.round(cells * METERS_PER_CELL)} m`;
}

export function euros(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

export function cableCost(kind: CableKind, lengthCells: number): number {
  const spec = CABLES[kind];
  return spec.base + spec.perCell * Math.max(1, Math.round(lengthCells));
}
