// Graphe réseau dérivé du niveau (postes fixes) et de la conception du joueur (matériel, câbles, Wi-Fi).

import { CABLES, DEVICES, INTERNET_DEFAULTS, ROOM_COOLING, SERVER_DEFAULTS, WIFI_LINK } from './catalog.ts';
import { brokenCables, cableLength, deviceLabel, endpointLabel, type Design } from './design.ts';
import { roomAt, type LevelDef, type RoomKind } from './level.ts';
import type { LinkKind, NodeKind, Proto, Vec } from './types.ts';

export interface NetNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Centre de la case, en unités de grille. */
  x: number;
  y: number;
  cell: Vec;
  fixed: boolean;
  group?: string;
  pool?: string;
  room?: string;
  roomKind: RoomKind | 'corridor';
  ports: number;
  capacity: number;
  queueMax: number;
  l3: boolean;
  nat: boolean;
  /** Peut relayer des paquets (équipement actif). */
  transit: boolean;
  endpoint: boolean;
  heat: number;
  cooling: number;
  wifi?: { radius: number; clients: number };
  service?: { proto: Proto; port: number };
  isp?: number;
}

export interface NetLink {
  id: string;
  a: string;
  b: string;
  kind: LinkKind;
  length: number;
  capacity: number;
  speed: number;
  broken: boolean;
  cableId?: string;
  /** Rang parmi les liens parallèles entre les deux mêmes nœuds (décalage au rendu). */
  index: number;
  parallel: number;
}

export interface Network {
  nodes: NetNode[];
  byId: Map<string, NetNode>;
  links: NetLink[];
  linkById: Map<string, NetLink>;
  adj: Map<string, NetLink[]>;
  uncovered: string[];
  wifiClients: Map<string, string[]>;
}

export function otherEnd(link: NetLink, id: string): string {
  return link.a === id ? link.b : link.a;
}

export function buildNetwork(level: LevelDef, design: Design): Network {
  const nodes: NetNode[] = [];
  const place = (x: number, y: number) => {
    const room = roomAt(level, x, y);
    return { room: room?.id, roomKind: room?.kind ?? ('corridor' as const) };
  };

  for (const e of level.endpoints) {
    const r = place(e.x, e.y);
    const server = e.kind === 'server';
    nodes.push({
      id: e.id,
      kind: e.kind,
      label: endpointLabel(e),
      x: e.x + 0.5,
      y: e.y + 0.5,
      cell: { x: e.x, y: e.y },
      fixed: true,
      group: e.group,
      pool: e.pool,
      ...r,
      ports: e.kind === 'workstation' ? 1 : e.kind === 'laptop' ? 0 : server ? SERVER_DEFAULTS.ports : INTERNET_DEFAULTS.ports,
      capacity: server ? (e.capacity ?? SERVER_DEFAULTS.capacity) : Infinity,
      queueMax: server ? SERVER_DEFAULTS.queue : Infinity,
      l3: false,
      nat: false,
      transit: false,
      endpoint: true,
      heat: server ? SERVER_DEFAULTS.heat : 0,
      cooling: ROOM_COOLING[r.roomKind] ?? 0.1,
      service: server ? { proto: e.proto ?? 'tcp', port: e.port ?? 445 } : undefined,
      isp: e.kind === 'internet' ? (e.isp ?? INTERNET_DEFAULTS.isp) : undefined,
    });
  }

  for (const d of design.devices) {
    const spec = DEVICES[d.kind];
    const r = place(d.x, d.y);
    nodes.push({
      id: d.id,
      kind: d.kind,
      label: deviceLabel(d),
      x: d.x + 0.5,
      y: d.y + 0.5,
      cell: { x: d.x, y: d.y },
      fixed: false,
      ...r,
      ports: spec.ports,
      capacity: spec.capacity,
      queueMax: spec.queue,
      l3: spec.l3,
      nat: spec.nat,
      transit: true,
      endpoint: false,
      heat: spec.heat,
      cooling: ROOM_COOLING[r.roomKind] ?? 0.1,
      wifi: spec.wifi,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: NetLink[] = [];
  const broken = brokenCables(level, design);

  for (const c of design.cables) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b) continue;
    const spec = CABLES[c.kind];
    // Le lien vers la box opérateur est limité par l'abonnement, pas par le cordon.
    let capacity = spec.capacity;
    for (const n of [a, b]) if (n.isp !== undefined) capacity = n.isp;
    links.push({
      id: c.id,
      a: c.a,
      b: c.b,
      kind: c.kind,
      length: cableLength(a.cell, b.cell),
      capacity,
      speed: spec.speed,
      broken: broken.has(c.id),
      cableId: c.id,
      index: 0,
      parallel: 1,
    });
  }

  // Association Wi-Fi : chaque portable rejoint la borne la plus proche qui a encore de la place.
  const wifiClients = new Map<string, string[]>();
  const aps = nodes.filter((n) => n.wifi);
  for (const ap of aps) wifiClients.set(ap.id, []);
  const uncovered: string[] = [];
  const laptops = nodes.filter((n) => n.kind === 'laptop').sort((p, q) => p.id.localeCompare(q.id));
  for (const lap of laptops) {
    const options = aps
      .map((ap) => ({ ap, d: Math.hypot(ap.x - lap.x, ap.y - lap.y) }))
      .filter((o) => o.d <= o.ap.wifi!.radius)
      .sort((p, q) => p.d - q.d || p.ap.id.localeCompare(q.ap.id));
    const choice = options.find((o) => wifiClients.get(o.ap.id)!.length < o.ap.wifi!.clients);
    if (!choice) {
      uncovered.push(lap.id);
      continue;
    }
    wifiClients.get(choice.ap.id)!.push(lap.id);
    links.push({
      id: `w:${lap.id}`,
      a: choice.ap.id,
      b: lap.id,
      kind: 'wifi',
      length: Math.max(1, choice.d),
      capacity: WIFI_LINK.capacity,
      speed: WIFI_LINK.speed,
      broken: false,
      index: 0,
      parallel: 1,
    });
  }

  // Liens parallèles (agrégation) : rang et nombre pour le rendu.
  const pairs = new Map<string, NetLink[]>();
  for (const l of links) {
    const key = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
    const list = pairs.get(key) ?? [];
    list.push(l);
    pairs.set(key, list);
  }
  for (const list of pairs.values()) {
    list.forEach((l, i) => {
      l.index = i;
      l.parallel = list.length;
    });
  }

  const adj = new Map<string, NetLink[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const l of links) {
    if (l.broken) continue;
    adj.get(l.a)!.push(l);
    adj.get(l.b)!.push(l);
  }

  return {
    nodes,
    byId,
    links,
    linkById: new Map(links.map((l) => [l.id, l])),
    adj,
    uncovered,
    wifiClients,
  };
}
