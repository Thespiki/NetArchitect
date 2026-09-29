// Mission format: floor plan, fixed endpoints, traffic, events and objectives.
// Player-facing texts are `Loc` values, written in every supported language.

import { loc, T, type Loc } from '../i18n/index.ts';
import type { CoachTip, GuideStep } from './guide.ts';
import type { CableKind, EndpointKind, EquipmentKind, Feature, Proto, Vec } from './types.ts';

export type RoomKind = 'office' | 'server' | 'meeting' | 'it' | 'lobby';

export interface RoomDef {
  id: string;
  name: Loc;
  kind: RoomKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroupDef {
  id: string;
  name: Loc;
  color: string;
  /** Other identifiers accepted by the console (e.g. a translated name). */
  aliases?: string[];
}

export interface EndpointDef {
  id: string;
  kind: EndpointKind;
  x: number;
  y: number;
  group?: string;
  /** Servers: service pool (several servers can share a pool). */
  pool?: string;
  label?: Loc;
  /** Servers: requests handled per second. */
  capacity?: number;
  /** Internet: bandwidth of the ISP subscription (u/s). */
  isp?: number;
  /** Servers: protocol/port of the service. */
  proto?: Proto;
  port?: number;
}

export interface GroupTraffic {
  /** Requests per second and per computer at the peak of the day. */
  rate: number;
  mix: Partial<Record<'web' | 'stream' | 'data', number>>;
  /** Internal pools targeted by "data" traffic. */
  data?: string[];
}

export interface TrafficDef {
  groups: Record<string, GroupTraffic>;
  customers?: { pool: string; rate: number };
  curve: 'office' | 'shop';
}

/** Security audit probes: forbidden access attempts that must be blocked. */
export interface AuditDef {
  from: string;
  to: string;
  rate: number;
  label: Loc;
}

export type EventDef =
  | { kind: 'peak'; at: number; duration: number; factor: number; target: 'all' | 'customers' | 'stream'; message: Loc }
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
      name: Loc;
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

export interface LevelDef {
  id: string;
  /** 0 is the training mission; the campaign starts at 1. */
  order: number;
  company: string;
  title: Loc;
  tagline: Loc;
  brief: Loc[];
  newMechanics: { title: Loc; text: Loc }[];
  size: { w: number; h: number };
  rooms: RoomDef[];
  groups: GroupDef[];
  endpoints: EndpointDef[];
  techBase: Vec;
  budget: number;
  /** Real-time length (s) of the 9:00 → 18:00 day at ×1 speed. */
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
  tips: Loc[];
  /** Checklist shown in the side panel. */
  guide?: GuideStep[];
  /** Step-by-step walkthrough with highlights (training mission). */
  tutorial?: GuideStep[];
  /** Hints that pop up when a situation first occurs. */
  coach?: CoachTip[];
  seed: number;
}

export function roomAt(level: LevelDef, x: number, y: number): RoomDef | undefined {
  return level.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

export function groupName(level: LevelDef, id: string | undefined): string {
  if (!id) return '—';
  const g = level.groups.find((x) => x.id === id);
  return g ? loc(g.name) : id;
}

/** Career rank attached to a mission (the training mission is the intern's). */
export function rankName(order: number): string {
  return T.ranks[Math.max(0, Math.min(order, T.ranks.length - 1))];
}

export function hasFeature(level: LevelDef, f: Feature): boolean {
  return level.features.includes(f);
}

/** Displayed time for a fraction of the day (0 → 9:00, 1 → 18:00). */
export function clockLabel(fraction: number): string {
  const minutes = Math.round(9 * 60 + Math.min(1, Math.max(0, fraction)) * 9 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
