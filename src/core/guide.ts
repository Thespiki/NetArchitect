// Tutorial and guidance: steps that watch what the player does and point at the right place.
// The game screen builds a GuideState snapshot every few frames; steps only read it.

import type { Loc } from '../i18n/index.ts';
import type { NetConfig } from './config.ts';
import type { EquipmentKind, Phase } from './types.ts';

export interface GuideState {
  phase: Phase;
  view: 'phys' | 'topo';
  devices: { id: string; kind: EquipmentKind; x: number; y: number }[];
  cables: { a: string; b: string }[];
  tool: 'select' | 'place' | 'cable' | 'delete';
  /** Equipment or cable kind of the active tool. */
  toolKind?: string;
  /** First end of the cable being drawn. */
  cableFrom?: string;
  selected?: string;
  cameraMoved: boolean;
  /** Console commands typed during this mission, with their outcome. */
  commands: { cmd: string; ok: boolean }[];
  config: NetConfig;
  /** Number of warnings and errors in the diagnostics. */
  issues: number;
  running: boolean;
  finished: boolean;
  paused: boolean;
  speed: number;
  live: LiveState | null;
}

export interface LiveState {
  t: number;
  /** Incidents in progress (not resolved, not over). */
  active: ('failure' | 'ddos' | 'worm')[];
  resolved: ('failure' | 'ddos' | 'worm')[];
  /** Nodes that are down because of a failure. */
  failed: string[];
  infected: string[];
  quarantined: string[];
  /** A link above 90% utilization. */
  saturated: boolean;
  /** A device above 70 °C. */
  hot: boolean;
  frustration: number;
}

/** What to highlight: an interface element (data-tut attribute), a node or an area of the floor. */
export type GuideTarget = { ui: string } | { node: string } | { area: { x: number; y: number; w: number; h: number } };

export interface GuideStep {
  id: string;
  text: Loc;
  /** Completion test. Without it, the step waits for the player to click "Next". */
  done?: (s: GuideState) => boolean;
  target?: (s: GuideState) => GuideTarget | null;
  /** Freezes the day while the step is displayed. */
  pause?: boolean;
  /** Shows "Next" even though the step has a completion test. */
  skippable?: boolean;
}

/** A hint shown once, the first time its condition becomes true during a mission. */
export interface CoachTip {
  id: string;
  text: Loc;
  when: (s: GuideState) => boolean;
  /** Hides the hint once the player has done what it suggests. */
  done?: (s: GuideState) => boolean;
  target?: (s: GuideState) => GuideTarget | null;
}

// ---------------------------------------------------------------------------
// Predicates shared by the missions

export const hasDevice = (s: GuideState, kind: string): boolean => s.devices.some((d) => d.kind === kind);

export const deviceOf = (s: GuideState, kind: string): string | undefined => s.devices.find((d) => d.kind === kind)?.id;

export const isKind =
  (s: GuideState, kind: string) =>
  (id: string): boolean =>
    s.devices.some((d) => d.id === id && d.kind === kind);

export const linked = (s: GuideState, a: (id: string) => boolean, b: (id: string) => boolean): boolean =>
  s.cables.some((c) => (a(c.a) && b(c.b)) || (a(c.b) && b(c.a)));

export const cabled = (s: GuideState, id: string): boolean => s.cables.some((c) => c.a === id || c.b === id);

/** A console command starting with `prefix` was run successfully. */
export const ran = (s: GuideState, prefix: string): boolean =>
  s.commands.some((c) => c.ok && c.cmd.trim().toLowerCase().startsWith(prefix));
