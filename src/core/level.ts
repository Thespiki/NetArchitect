// Format des missions : plan de l'étage, postes fixes, trafic, événements et objectifs.

import type { CableKind, EndpointKind, EquipmentKind, Feature, Phase, Proto, Vec } from './types.ts';

export type RoomKind = 'office' | 'server' | 'meeting' | 'it' | 'lobby';

export interface RoomDef {
  id: string;
  name: string;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroupDef {
  id: string;
  name: string;
  color: string;
}

export interface EndpointDef {
  id: string;
  kind: EndpointKind;
  x: number;
  y: number;
  group?: string;
  /** Serveurs : pool de service (plusieurs serveurs peuvent partager un pool). */
  pool?: string;
  label?: string;
  /** Serveurs : requêtes traitées par seconde. */
  capacity?: number;
  /** Internet : débit de l'abonnement opérateur (u/s). */
  isp?: number;
  /** Serveurs : protocole/port du service. */
  proto?: Proto;
  port?: number;
}

export interface GroupTraffic {
  /** Requêtes par seconde et par poste au pic de la journée. */
  rate: number;
  mix: Partial<Record<'web' | 'stream' | 'data', number>>;
  /** Pools internes visés par le trafic « data ». */
  data?: string[];
}

export interface TrafficDef {
  groups: Record<string, GroupTraffic>;
  customers?: { pool: string; rate: number };
  curve: 'office' | 'shop';
}

/** Sondes d'audit de sécurité : tentatives d'accès interdites qui doivent être bloquées. */
export interface AuditDef {
  from: string;
  to: string;
  rate: number;
  label: string;
}

export type EventDef =
  | { kind: 'peak'; at: number; duration: number; factor: number; target: 'all' | 'customers' | 'stream'; message: string }
  | {
      kind: 'ddos';
      at: number;
      duration: number;
      rate: number;
      ramp: number;
      target: string;
      proto: Proto;
      port: number;
      sources: string;
      name: string;
    }
  | { kind: 'failure'; at: number; target: string; deadline: number }
  | { kind: 'worm'; at: number; patient: string; rate: number; chance: number };

export type ObjectiveDef =
  | { kind: 'survive' }
  | { kind: 'noBreach' }
  | { kind: 'incidents' }
  | { kind: 'infected'; max: number }
  | { kind: 'service'; pool: string; min: number };

export type StarDef =
  | { kind: 'avgFrustration'; max: number }
  | { kind: 'spent'; max: number }
  | { kind: 'mitigation'; max: number }
  | { kind: 'lossRate'; max: number };

/** État minimal exposé aux étapes du tutoriel. */
export interface GuideState {
  phase: Phase;
  devices: { id: string; kind: EquipmentKind; x: number; y: number }[];
  cables: { a: string; b: string }[];
  running: boolean;
}

export interface GuideStep {
  text: string;
  done: (s: GuideState) => boolean;
}

export interface LevelDef {
  id: string;
  order: number;
  company: string;
  title: string;
  rank: string;
  tagline: string;
  brief: string[];
  newMechanics: { title: string; text: string }[];
  size: { w: number; h: number };
  rooms: RoomDef[];
  groups: GroupDef[];
  endpoints: EndpointDef[];
  techBase: Vec;
  budget: number;
  /** Durée réelle (s) de la journée 9 h → 18 h à vitesse ×1. */
  dayLength: number;
  features: Feature[];
  equipment: EquipmentKind[];
  cables: CableKind[];
  addressing: { mode: 'auto' } | { mode: 'manual'; block: string };
  traffic: TrafficDef;
  audits?: AuditDef[];
  events?: EventDef[];
  objectives: ObjectiveDef[];
  stars: StarDef[];
  tips: string[];
  guide?: GuideStep[];
  seed: number;
}

export function roomAt(level: LevelDef, x: number, y: number): RoomDef | undefined {
  return level.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

export function groupName(level: LevelDef, id: string | undefined): string {
  if (!id) return '—';
  return level.groups.find((g) => g.id === id)?.name ?? id;
}

export function hasFeature(level: LevelDef, f: Feature): boolean {
  return level.features.includes(f);
}

/** Heure affichée pour une fraction de journée (0 → 9:00, 1 → 18:00). */
export function clockLabel(fraction: number): string {
  const minutes = Math.round(9 * 60 + Math.min(1, Math.max(0, fraction)) * 9 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
