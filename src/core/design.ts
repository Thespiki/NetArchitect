// Conception du joueur : matériel posé, câbles tirés, budget et règles de câblage.

import { CABLES, DEVICES, cableCost, meters } from './catalog.ts';
import { roomAt, type EndpointDef, type LevelDef } from './level.ts';
import type { CableKind, EquipmentKind, NodeKind, SkillId, Vec } from './types.ts';

export interface PlacedDevice {
  id: string;
  kind: EquipmentKind;
  x: number;
  y: number;
}

export interface Cable {
  id: string;
  a: string;
  b: string;
  kind: CableKind;
}

export interface Design {
  devices: PlacedDevice[];
  cables: Cable[];
  seq: number;
}

export function emptyDesign(): Design {
  return { devices: [], cables: [], seq: 1 };
}

export function cloneDesign(d: Design): Design {
  return {
    devices: d.devices.map((x) => ({ ...x })),
    cables: d.cables.map((c) => ({ ...c })),
    seq: d.seq,
  };
}

export interface NodeRef {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  fixed: boolean;
  ports: number;
  label: string;
}

const ENDPOINT_PORTS: Record<EndpointDef['kind'], number> = {
  workstation: 1,
  laptop: 0,
  server: 2,
  internet: 2,
};

export function endpointLabel(e: EndpointDef): string {
  return e.label ?? e.id.toUpperCase();
}

export function deviceLabel(d: PlacedDevice): string {
  return d.id.toUpperCase();
}

export function nodeRef(level: LevelDef, design: Design, id: string): NodeRef | undefined {
  const e = level.endpoints.find((x) => x.id === id);
  if (e) return { id, kind: e.kind, x: e.x, y: e.y, fixed: true, ports: ENDPOINT_PORTS[e.kind], label: endpointLabel(e) };
  const d = design.devices.find((x) => x.id === id);
  if (d) return { id, kind: d.kind, x: d.x, y: d.y, fixed: false, ports: DEVICES[d.kind].ports, label: deviceLabel(d) };
  return undefined;
}

export function allNodeRefs(level: LevelDef, design: Design): NodeRef[] {
  const out: NodeRef[] = [];
  for (const e of level.endpoints) out.push(nodeRef(level, design, e.id)!);
  for (const d of design.devices) out.push(nodeRef(level, design, d.id)!);
  return out;
}

export function isEquipment(kind: NodeKind): kind is EquipmentKind {
  return kind in DEVICES;
}

/** Longueur d'un câble : trajet orthogonal (goulottes), en cases. */
export function cableLength(a: Vec, b: Vec): number {
  return Math.max(1, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
}

export function portsUsed(design: Design, id: string): number {
  let n = 0;
  for (const c of design.cables) {
    if (c.a === id) n++;
    if (c.b === id) n++;
  }
  return n;
}

export function availableKit(level: LevelDef, skills: ReadonlySet<SkillId>): {
  equipment: Set<EquipmentKind>;
  cables: Set<CableKind>;
} {
  const equipment = new Set<EquipmentKind>(level.equipment);
  for (const spec of Object.values(DEVICES)) {
    if (spec.skill && skills.has(spec.skill)) equipment.add(spec.kind);
  }
  const cables = new Set<CableKind>(level.cables);
  for (const spec of Object.values(CABLES)) {
    if (spec.skill && skills.has(spec.skill)) cables.add(spec.kind);
  }
  return { equipment, cables };
}

export function cableCurrentCost(level: LevelDef, design: Design, c: Cable): number {
  const a = nodeRef(level, design, c.a);
  const b = nodeRef(level, design, c.b);
  if (!a || !b) return 0;
  return cableCost(c.kind, cableLength(a, b));
}

export function designCost(level: LevelDef, design: Design): number {
  let total = 0;
  for (const d of design.devices) total += DEVICES[d.kind].cost;
  for (const c of design.cables) total += cableCurrentCost(level, design, c);
  return total;
}

/** Câbles devenus trop longs après un déplacement : ils ne transportent plus rien. */
export function brokenCables(level: LevelDef, design: Design): Set<string> {
  const out = new Set<string>();
  for (const c of design.cables) {
    const a = nodeRef(level, design, c.a);
    const b = nodeRef(level, design, c.b);
    if (!a || !b || cableLength(a, b) > CABLES[c.kind].maxLen) out.add(c.id);
  }
  return out;
}

export type Check =
  | { ok: true; cost: number; length?: number }
  | { ok: false; reason: string; cost?: number; length?: number };

export function occupied(level: LevelDef, design: Design, x: number, y: number, ignoreId?: string): boolean {
  if (level.endpoints.some((e) => e.x === x && e.y === y)) return true;
  return design.devices.some((d) => d.id !== ignoreId && d.x === x && d.y === y);
}

function inBounds(level: LevelDef, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.size.w && y < level.size.h;
}

export function canPlace(
  level: LevelDef,
  design: Design,
  kind: EquipmentKind,
  x: number,
  y: number,
  skills: ReadonlySet<SkillId>,
): Check {
  const spec = DEVICES[kind];
  if (!availableKit(level, skills).equipment.has(kind)) {
    return { ok: false, reason: `${spec.name} : pas encore débloqué.` };
  }
  if (!inBounds(level, x, y)) return { ok: false, reason: 'Hors du bâtiment.' };
  if (occupied(level, design, x, y)) return { ok: false, reason: 'Emplacement déjà occupé.' };
  const left = level.budget - designCost(level, design);
  if (spec.cost > left) return { ok: false, reason: `Budget insuffisant (il reste ${Math.round(left)} €).`, cost: spec.cost };
  return { ok: true, cost: spec.cost };
}

function nextId(design: Design, prefix: string): string {
  const used = new Set(design.devices.map((d) => d.id));
  for (let n = 1; ; n++) {
    const id = `${prefix.toLowerCase()}-${n}`;
    if (!used.has(id)) return id;
  }
}

export function placeDevice(
  level: LevelDef,
  design: Design,
  kind: EquipmentKind,
  x: number,
  y: number,
  skills: ReadonlySet<SkillId>,
): PlacedDevice | string {
  const check = canPlace(level, design, kind, x, y, skills);
  if (!check.ok) return check.reason;
  const dev: PlacedDevice = { id: nextId(design, DEVICES[kind].prefix), kind, x, y };
  design.devices.push(dev);
  return dev;
}

export function canMove(level: LevelDef, design: Design, id: string, x: number, y: number): Check {
  const dev = design.devices.find((d) => d.id === id);
  if (!dev) return { ok: false, reason: 'Élément fixe : il ne peut pas être déplacé.' };
  if (!inBounds(level, x, y)) return { ok: false, reason: 'Hors du bâtiment.' };
  if (occupied(level, design, x, y, id)) return { ok: false, reason: 'Emplacement déjà occupé.' };
  return { ok: true, cost: 0 };
}

export function moveDevice(level: LevelDef, design: Design, id: string, x: number, y: number): boolean {
  if (!canMove(level, design, id, x, y).ok) return false;
  const dev = design.devices.find((d) => d.id === id)!;
  dev.x = x;
  dev.y = y;
  return true;
}

export function removeDevice(design: Design, id: string): boolean {
  const before = design.devices.length;
  design.devices = design.devices.filter((d) => d.id !== id);
  design.cables = design.cables.filter((c) => c.a !== id && c.b !== id);
  return design.devices.length !== before;
}

export function removeCable(design: Design, id: string): boolean {
  const before = design.cables.length;
  design.cables = design.cables.filter((c) => c.id !== id);
  return design.cables.length !== before;
}

export function canConnect(
  level: LevelDef,
  design: Design,
  aId: string,
  bId: string,
  kind: CableKind,
  skills: ReadonlySet<SkillId>,
): Check {
  const spec = CABLES[kind];
  if (aId === bId) return { ok: false, reason: 'Choisis deux éléments différents.' };
  const a = nodeRef(level, design, aId);
  const b = nodeRef(level, design, bId);
  if (!a || !b) return { ok: false, reason: 'Élément introuvable.' };
  const length = cableLength(a, b);
  const cost = cableCost(kind, length);
  const fail = (reason: string): Check => ({ ok: false, reason, cost, length });
  if (!availableKit(level, skills).cables.has(kind)) return fail(`${spec.name} : pas encore débloqué.`);
  if (a.kind === 'laptop' || b.kind === 'laptop') {
    return fail('Les portables se connectent en Wi-Fi : place une borne à portée.');
  }
  const aEq = isEquipment(a.kind);
  const bEq = isEquipment(b.kind);
  if (!aEq && !bEq) return fail('Relie les postes à un switch ou à un routeur, pas directement entre eux.');
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    if (x.kind === 'internet' && !(isEquipment(y.kind) && DEVICES[y.kind].nat)) {
      return fail('L’arrivée opérateur se branche sur un routeur (NAT).');
    }
    if (x.kind === 'ap' && !isEquipment(y.kind)) {
      return fail('La borne Wi-Fi n’a qu’un port : son lien montant vers un switch ou un routeur.');
    }
  }
  for (const n of [a, b]) {
    const used = portsUsed(design, n.id);
    if (used >= n.ports) return fail(`${n.label} : plus de port libre (${used}/${n.ports}).`);
  }
  if (length > spec.maxLen) {
    return fail(`Trop long : ${meters(length)} (max ${meters(spec.maxLen)} en ${kind === 'rj45' ? 'RJ45' : 'fibre'}).`);
  }
  const left = level.budget - designCost(level, design);
  if (cost > left) return fail(`Budget insuffisant (il reste ${Math.round(left)} €).`);
  return { ok: true, cost, length };
}

export function connect(
  level: LevelDef,
  design: Design,
  aId: string,
  bId: string,
  kind: CableKind,
  skills: ReadonlySet<SkillId>,
): Cable | string {
  const check = canConnect(level, design, aId, bId, kind, skills);
  if (!check.ok) return check.reason;
  const cable: Cable = { id: `c${design.seq++}`, a: aId, b: bId, kind };
  design.cables.push(cable);
  return cable;
}

/**
 * Raccorde en RJ45 les postes de travail non câblés les plus proches du switch/routeur choisi :
 * ceux de sa pièce, ou ceux à portée s'il est dans un couloir. Les serveurs se câblent à la main.
 */
export function autoCable(level: LevelDef, design: Design, hubId: string, skills: ReadonlySet<SkillId>): number {
  const hub = nodeRef(level, design, hubId);
  if (!hub || !isEquipment(hub.kind) || hub.kind === 'ap') return 0;
  const room = roomAt(level, hub.x, hub.y);
  const candidates = level.endpoints
    .filter((e) => e.kind === 'workstation' && portsUsed(design, e.id) === 0)
    .filter((e) => !room || roomAt(level, e.x, e.y)?.id === room.id)
    .map((e) => ({ e, d: cableLength(hub, e) }))
    .filter((c) => c.d <= CABLES.rj45.maxLen)
    .sort((p, q) => p.d - q.d || p.e.id.localeCompare(q.e.id));
  let added = 0;
  for (const { e } of candidates) {
    if (portsUsed(design, hubId) >= hub.ports) break;
    const res = connect(level, design, hubId, e.id, 'rj45', skills);
    if (typeof res !== 'string') added++;
  }
  return added;
}

export function uncabledEndpoints(level: LevelDef, design: Design): EndpointDef[] {
  return level.endpoints.filter(
    (e) => (e.kind === 'workstation' || e.kind === 'server' || e.kind === 'internet') && portsUsed(design, e.id) === 0,
  );
}
