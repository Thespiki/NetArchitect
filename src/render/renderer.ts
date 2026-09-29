// Canvas rendering: floor plan ⇄ topology view (morph), neon packets in additive mode.

import { loc, T } from '../i18n/index.ts';
import { DEVICES, TRAFFIC, tempCelsius } from '../core/catalog.ts';
import { portsUsed, type Design } from '../core/design.ts';
import type { LevelDef } from '../core/level.ts';
import type { NetLink, Network } from '../core/network.ts';
import type { Packet, Simulation } from '../core/simulation.ts';
import type { CableKind, EquipmentKind, Phase, TrafficKind, Vec } from '../core/types.ts';
import { Camera } from './camera.ts';
import { drawGlyph, FONT_DISPLAY, FONT_MONO, glowSprite, glyphRadius, hexAlpha, loadColor, PAL } from './glyphs.ts';

export interface Hover {
  node?: string;
  link?: string;
  cell?: Vec;
}

export interface Ghost {
  kind: EquipmentKind;
  cell: Vec;
  ok: boolean;
}

export interface CablePreview {
  from: string;
  to: Vec;
  target?: string;
  ok: boolean;
  kind: CableKind;
  label: string;
}

export interface PathHighlight {
  nodes: string[];
  ok: boolean;
  start: number;
}

export interface RenderInput {
  level: LevelDef;
  net: Network;
  design: Design;
  sim: Simulation | null;
  phase: Phase;
  morph: number;
  topo: Map<string, Vec>;
  now: number;
  hover: Hover;
  selected: { node?: string; link?: string };
  ghost: Ghost | null;
  cable: CablePreview | null;
  path: PathHighlight | null;
  warnNodes: Set<string>;
  showCoverage: boolean;
  snmp: boolean;
  roomGroups: Map<string, string>;
  reducedMotion: boolean;
}

const INTERNET_COLOR = '#6fd6ff';

function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function along(pts: Vec[], f: number): Vec {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let d = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (d <= seg || i === pts.length - 1) return seg > 0 ? lerp(pts[i - 1], pts[i], Math.min(1, d / seg)) : pts[i];
    d -= seg;
  }
  return pts[pts.length - 1];
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export class Renderer {
  readonly camera = new Camera();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly pos = new Map<string, Vec>();
  private readonly polys = new Map<string, Vec[]>();
  private readonly elbows = new WeakMap<NetLink, boolean>();
  private input: RenderInput | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    for (const t of Object.values(TRAFFIC)) this.sprites.set(t.kind, glowSprite(t.color));
    this.sprites.set('white', glowSprite('#ffffff'));
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  fit(level: LevelDef): void {
    const margin = this.w < 520 ? 10 : 28;
    this.camera.fit(this.w, this.h, level.size.w, level.size.h, margin);
  }

  // -------------------------------------------------------------------------
  // Geometry

  private geometry(inp: RenderInput): void {
    const e = inp.morph;
    this.pos.clear();
    for (const n of inp.net.nodes) {
      const t = inp.topo.get(n.id) ?? { x: n.x, y: n.y };
      this.pos.set(n.id, lerp({ x: n.x, y: n.y }, t, e));
    }
    this.polys.clear();
    for (const l of inp.net.links) this.polys.set(l.id, this.linkPoints(inp, l, e));
  }

  private linkPoints(inp: RenderInput, l: NetLink, e: number): Vec[] {
    const a = inp.net.byId.get(l.a)!;
    const b = inp.net.byId.get(l.b)!;
    const ta = inp.topo.get(l.a) ?? a;
    const tb = inp.topo.get(l.b) ?? b;
    const off = (l.index - (l.parallel - 1) / 2) * 0.2;
    let phys: Vec[];
    if (l.kind === 'wifi') phys = [a, lerp(a, b, 0.5), b];
    else if (this.verticalFirst(inp, l))
      phys = [
        { x: a.x + off, y: a.y },
        { x: a.x + off, y: b.y + off },
        { x: b.x, y: b.y + off },
      ];
    else
      phys = [
        { x: a.x, y: a.y + off },
        { x: b.x + off, y: a.y + off },
        { x: b.x + off, y: b.y },
      ];
    const dx = tb.x - ta.x;
    const dy = tb.y - ta.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * off;
    const ny = (dx / len) * off;
    const topo: Vec[] = [
      { x: ta.x + nx, y: ta.y + ny },
      { x: (ta.x + tb.x) / 2 + nx, y: (ta.y + tb.y) / 2 + ny },
      { x: tb.x + nx, y: tb.y + ny },
    ];
    return phys.map((p, i) => lerp(p, topo[i], e));
  }

  /** Picks the cable elbow (horizontal or vertical first) that crosses the fewest devices. */
  private verticalFirst(inp: RenderInput, l: NetLink): boolean {
    const cached = this.elbows.get(l);
    if (cached !== undefined) return cached;
    const a = inp.net.byId.get(l.a)!;
    const b = inp.net.byId.get(l.b)!;
    const hits = (corner: Vec) => {
      let n = 0;
      for (const o of inp.net.nodes) {
        if (o.id === l.a || o.id === l.b) continue;
        for (const [p, q] of [
          [a, corner],
          [corner, b],
        ] as const) {
          if (distToSegment(o, p, q) < 0.45) {
            n++;
            break;
          }
        }
      }
      return n;
    };
    const vertical = hits({ x: a.x, y: b.y }) < hits({ x: b.x, y: a.y });
    this.elbows.set(l, vertical);
    return vertical;
  }

  worldPos(id: string): Vec | undefined {
    return this.pos.get(id);
  }

  /** Screen rectangle (CSS pixels, canvas-relative) around a node, for highlights. */
  nodeRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const p = this.pos.get(id);
    const n = this.input?.net.byId.get(id);
    if (!p || !n) return null;
    const q = this.camera.toScreen(p.x, p.y);
    const r = Math.max(14, (glyphRadius(n.kind) + 0.35) * this.camera.scale);
    return { x: q.x - r, y: q.y - r, w: r * 2, h: r * 2 };
  }

  /** Screen rectangle of an area of the floor (in cells). */
  areaRect(a: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
    const q = this.camera.toScreen(a.x, a.y);
    return { x: q.x, y: q.y, w: a.w * this.camera.scale, h: a.h * this.camera.scale };
  }

  packetPos(p: Packet): Vec | null {
    if (!p.link) return null;
    const pts = this.polys.get(p.link.id);
    if (!pts) return null;
    return along(pts, p.from === p.link.a ? p.progress : 1 - p.progress);
  }

  // -------------------------------------------------------------------------
  // Mouse picking

  pickNode(px: number, py: number): string | undefined {
    if (!this.input) return undefined;
    const w = this.camera.toWorld(px, py);
    const minWorld = 9 / this.camera.scale;
    let best: string | undefined;
    let bestD = Infinity;
    for (const n of this.input.net.nodes) {
      const p = this.pos.get(n.id);
      if (!p) continue;
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      if (d < Math.max(minWorld, glyphRadius(n.kind) + 0.1) && d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  pickLink(px: number, py: number): string | undefined {
    if (!this.input) return undefined;
    const w = this.camera.toWorld(px, py);
    const tol = Math.max(0.2, 6 / this.camera.scale);
    let best: string | undefined;
    let bestD = Infinity;
    for (const l of this.input.net.links) {
      if (l.kind === 'wifi') continue;
      const pts = this.polys.get(l.id);
      if (!pts) continue;
      for (let i = 1; i < pts.length; i++) {
        const d = distToSegment(w, pts[i - 1], pts[i]);
        if (d < tol && d < bestD) {
          bestD = d;
          best = l.id;
        }
      }
    }
    return best;
  }

  pickPacket(px: number, py: number): Packet | undefined {
    const sim = this.input?.sim;
    if (!sim) return undefined;
    const w = this.camera.toWorld(px, py);
    const tol = Math.max(0.35, 8 / this.camera.scale);
    let best: Packet | undefined;
    let bestD = Infinity;
    for (const p of sim.packets) {
      if (p.dead || !p.link) continue;
      const pos = this.packetPos(p);
      if (!pos) continue;
      const d = Math.hypot(w.x - pos.x, w.y - pos.y);
      if (d < tol && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  cellAt(px: number, py: number): Vec {
    const w = this.camera.toWorld(px, py);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  // -------------------------------------------------------------------------
  // Drawing

  render(inp: RenderInput): void {
    this.input = inp;
    this.geometry(inp);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const phys = 1 - inp.morph;
    if (phys > 0.01) this.drawFloor(inp, phys);
    if (inp.morph > 0.01) this.drawTopoBackdrop(inp.morph);
    if (inp.showCoverage && phys > 0.01) this.drawCoverage(inp, phys);
    this.drawLinks(inp);
    if (inp.path) this.drawPath(inp, inp.path);
    if (inp.sim) this.drawPackets(inp, inp.sim);
    this.drawNodes(inp);
    if (inp.sim) {
      this.drawQueues(inp, inp.sim);
      this.drawEffects(inp.sim);
      if (phys > 0.01) this.drawTechs(inp, inp.sim, phys);
    }
    if (inp.cable) this.drawCablePreview(inp, inp.cable);
    if (inp.ghost && phys > 0.5) this.drawGhost(inp.ghost);
    this.drawLabels(inp);
  }

  private sc(v: Vec): Vec {
    return this.camera.toScreen(v.x, v.y);
  }

  private drawFloor(inp: RenderInput, alpha: number): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const { w, h } = inp.level.size;
    ctx.save();
    ctx.globalAlpha = alpha;
    const tl = this.sc({ x: 0, y: 0 });
    ctx.strokeStyle = 'rgba(140, 170, 220, 0.3)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w * s, h * s);
    // Dot grid at the cell corners.
    if (s >= 12) {
      ctx.fillStyle = PAL.grid;
      for (let x = 1; x < w; x++) {
        for (let y = 1; y < h; y++) {
          ctx.fillRect(tl.x + x * s - 0.75, tl.y + y * s - 0.75, 1.5, 1.5);
        }
      }
    }
    const sim = inp.sim;
    for (const r of inp.level.rooms) {
      const p = this.sc({ x: r.x, y: r.y });
      ctx.fillStyle = r.kind === 'server' ? PAL.serverRoom : PAL.roomFill;
      ctx.fillRect(p.x, p.y, r.w * s, r.h * s);
      const group = inp.roomGroups.get(r.id);
      if (sim && group) {
        const mood = sim.moodOf(group);
        if (mood > 0.04) {
          const pulse = inp.reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(inp.now * 4);
          ctx.fillStyle = hexAlpha(PAL.crit, Math.min(0.26, mood * 0.55) * pulse);
          ctx.fillRect(p.x, p.y, r.w * s, r.h * s);
        }
      }
      ctx.strokeStyle = PAL.roomLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, r.w * s - 1, r.h * s - 1);
      const fs = Math.max(9, Math.min(13, s * 0.36));
      ctx.font = `600 ${fs}px ${FONT_DISPLAY}`;
      ctx.fillStyle = r.kind === 'server' ? 'rgba(130, 190, 255, 0.8)' : PAL.roomLabel;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const name = loc(r.name).toUpperCase();
      const label = r.kind === 'server' ? `${name} · ${T.map.airConditioned}` : name;
      ctx.fillText(label, p.x + fs * 0.6, p.y + fs * 0.5, r.w * s - fs);
    }
    // Technician base.
    const base = this.sc({ x: inp.level.techBase.x + 0.5, y: inp.level.techBase.y + 0.5 });
    ctx.strokeStyle = 'rgba(255, 200, 110, 0.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(base.x, base.y, s * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawTopoBackdrop(alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.font = `600 ${Math.max(10, this.camera.scale * 0.32)}px ${FONT_DISPLAY}`;
    ctx.fillStyle = PAL.roomLabel;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const p = this.sc({ x: 0.3, y: this.input!.level.size.h - 0.2 });
    ctx.fillText(T.map.topology, p.x, p.y);
    ctx.restore();
  }

  private drawCoverage(inp: RenderInput, alpha: number): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const n of inp.net.nodes) {
      if (!n.wifi) continue;
      const p = this.sc(this.pos.get(n.id)!);
      ctx.fillStyle = 'rgba(111, 214, 255, 0.05)';
      ctx.strokeStyle = 'rgba(111, 214, 255, 0.28)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, n.wifi.radius * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private strokePoly(pts: Vec[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = this.sc(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
  }

  private drawLinks(inp: RenderInput): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const sim = inp.sim;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const l of inp.net.links) {
      const pts = this.polys.get(l.id)!;
      const selected = inp.selected.link === l.id;
      const hovered = inp.hover.link === l.id;
      if (l.kind === 'wifi') {
        ctx.strokeStyle = PAL.wifi;
        ctx.lineWidth = Math.max(1, s * 0.035);
        ctx.setLineDash([s * 0.12, s * 0.14]);
        this.strokePoly(pts);
        ctx.setLineDash([]);
        continue;
      }
      const base = l.kind === 'fiber' ? PAL.fiber : PAL.rj45;
      const width = Math.max(1.2, s * (l.kind === 'fiber' ? 0.1 : 0.075));
      if (l.broken) {
        ctx.strokeStyle = PAL.crit;
        ctx.lineWidth = width;
        ctx.setLineDash([s * 0.2, s * 0.15]);
        this.strokePoly(pts);
        ctx.setLineDash([]);
        continue;
      }
      if (selected || hovered) {
        ctx.strokeStyle = selected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)';
        ctx.lineWidth = width + s * 0.16;
        this.strokePoly(pts);
      }
      ctx.strokeStyle = base;
      ctx.lineWidth = width;
      this.strokePoly(pts);
      if (sim) {
        const util = sim.linkUtil(l.id);
        if (util > 0.55) {
          const t = Math.min(1, (util - 0.55) / 0.45);
          const pulse = util > 0.92 && !inp.reducedMotion ? 0.7 + 0.3 * Math.sin(inp.now * 8) : 1;
          ctx.strokeStyle = hexAlpha(util > 0.85 ? PAL.crit : PAL.warn, (0.25 + 0.6 * t) * pulse);
          ctx.lineWidth = width + s * 0.08 * t;
          this.strokePoly(pts);
        }
      }
    }
    ctx.restore();
  }

  private drawPath(inp: RenderInput, path: PathHighlight): void {
    const age = inp.now - path.start;
    if (age > 4 || path.nodes.length < 1) return;
    const ctx = this.ctx;
    const s = this.camera.scale;
    const alpha = age < 3 ? 1 : 1 - (age - 3);
    const color = path.ok ? PAL.ok : PAL.crit;
    const pts = path.nodes.map((id) => this.pos.get(id)).filter((p): p is Vec => !!p);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = hexAlpha(color, 0.25);
    ctx.lineWidth = s * 0.34;
    this.strokePoly(pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    this.strokePoly(pts);
    for (const p of pts) {
      const q = this.sc(p);
      ctx.beginPath();
      ctx.arc(q.x, q.y, s * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (pts.length > 1) {
      const f = Math.min(1, age / 1.6);
      const q = this.sc(along(pts, f));
      ctx.globalCompositeOperation = 'lighter';
      const size = s * 0.9;
      ctx.drawImage(this.sprites.get('white')!, q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.restore();
  }

  private drawPackets(inp: RenderInput, sim: Simulation): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sim.packets) {
      if (p.dead || !p.link) continue;
      const pts = this.polys.get(p.link.id);
      if (!pts) continue;
      const f = p.from === p.link.a ? p.progress : 1 - p.progress;
      const sprite = this.sprites.get(p.kind as TrafficKind)!;
      const size = s * (0.36 + 0.12 * Math.sqrt(p.size));
      if (!inp.reducedMotion) {
        const back = p.from === p.link.a ? f - 0.05 : f + 0.05;
        const t = this.sc(along(pts, back));
        ctx.globalAlpha = 0.35;
        ctx.drawImage(sprite, t.x - size * 0.35, t.y - size * 0.35, size * 0.7, size * 0.7);
      }
      const q = this.sc(along(pts, f));
      ctx.globalAlpha = 1;
      ctx.drawImage(sprite, q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.restore();
  }

  private drawQueues(inp: RenderInput, sim: Simulation): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    ctx.save();
    for (const st of sim.states.values()) {
      const total = sim.queued(st);
      if (total < 2) continue;
      const p = this.pos.get(st.node.id);
      if (!p) continue;
      const q = this.sc(p);
      const shown = Math.min(18, total);
      const sample: Packet[] = [...st.ingress];
      for (const e of st.egress.values()) sample.push(...e);
      const r = (glyphRadius(st.node.kind) + 0.28) * s;
      const spin = inp.reducedMotion ? 0 : inp.now * 0.8;
      for (let i = 0; i < shown; i++) {
        const a = spin + (i / shown) * Math.PI * 2;
        const pk = sample[i % Math.max(1, sample.length)];
        ctx.fillStyle = pk ? TRAFFIC[pk.kind].color : PAL.warn;
        ctx.beginPath();
        ctx.arc(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r, Math.max(1.2, s * 0.055), 0, Math.PI * 2);
        ctx.fill();
      }
      if (total > 18) {
        ctx.font = `600 ${Math.max(9, s * 0.26)}px ${FONT_MONO}`;
        ctx.fillStyle = PAL.warn;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${total - 18}`, q.x + r + 3, q.y - r * 0.6);
      }
    }
    ctx.restore();
  }

  private drawNodes(inp: RenderInput): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const sim = inp.sim;
    const groupColor = new Map(inp.level.groups.map((g) => [g.id, g.color]));
    for (const n of inp.net.nodes) {
      const p = this.pos.get(n.id)!;
      const q = this.sc(p);
      const st = sim?.states.get(n.id);
      const R = glyphRadius(n.kind) * s;
      const isEquip = n.transit;
      const stroke = n.kind === 'internet' ? INTERNET_COLOR : isEquip ? PAL.equipStroke : (groupColor.get(n.group ?? '') ?? PAL.equipStroke);

      // Heat halo.
      if (st && st.heat > 0.5 && st.up) {
        const hot = Math.min(1, (st.heat - 0.5) / 0.5);
        const pulse = hot > 0.7 && !inp.reducedMotion ? 0.7 + 0.3 * Math.sin(inp.now * 10) : 1;
        const g = ctx.createRadialGradient(q.x, q.y, R * 0.3, q.x, q.y, R * 2.2);
        g.addColorStop(0, hexAlpha(hot > 0.7 ? PAL.crit : PAL.warn, 0.45 * hot * pulse));
        g.addColorStop(1, hexAlpha(PAL.warn, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q.x, q.y, R * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const dimmed = st && (!st.up || st.quarantined);
      drawGlyph(ctx, n.kind, q.x, q.y, s, {
        stroke: dimmed ? PAL.dim : stroke,
        fill: isEquip ? PAL.equipFill : PAL.endpointFill,
        ports: isEquip ? { used: portsUsed(inp.design, n.id), total: DEVICES[n.kind as EquipmentKind].ports } : undefined,
        alpha: dimmed ? 0.7 : 1,
      });

      // Load ring.
      if (st && st.up && (n.transit || n.kind === 'server') && st.load > 0.04) {
        const ring = R + s * 0.16;
        ctx.save();
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, ring, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = loadColor(st.load);
        ctx.beginPath();
        ctx.arc(q.x, q.y, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, st.load));
        ctx.stroke();
        ctx.restore();
      }

      if (st && !st.up) {
        ctx.save();
        ctx.strokeStyle = st.down === 'overheat' ? PAL.warn : PAL.crit;
        ctx.lineWidth = Math.max(2, s * 0.08);
        const k = R * 0.55;
        ctx.beginPath();
        ctx.moveTo(q.x - k, q.y - k);
        ctx.lineTo(q.x + k, q.y + k);
        ctx.moveTo(q.x + k, q.y - k);
        ctx.lineTo(q.x - k, q.y + k);
        ctx.stroke();
        this.tag(q.x, q.y - R - s * 0.3, st.down === 'overheat' ? T.map.overheat : T.map.down, st.down === 'overheat' ? PAL.warn : PAL.crit);
        ctx.restore();
      }
      if (st?.infected && !st.quarantined) {
        const pulse = inp.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(inp.now * 6);
        ctx.save();
        ctx.strokeStyle = hexAlpha(PAL.crit, pulse);
        ctx.lineWidth = Math.max(1.5, s * 0.07);
        ctx.beginPath();
        ctx.arc(q.x, q.y, R + s * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (st?.quarantined) {
        ctx.save();
        ctx.strokeStyle = 'rgba(200, 210, 230, 0.7)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, R + s * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        this.tag(q.x, q.y - R - s * 0.3, st.infected ? T.map.isolatedInfected : T.map.isolated, st.infected ? PAL.crit : PAL.dim);
      }
      if (!sim && inp.warnNodes.has(n.id)) {
        const pulse = inp.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(inp.now * 3);
        ctx.save();
        ctx.fillStyle = hexAlpha(PAL.warn, pulse);
        ctx.beginPath();
        ctx.arc(q.x + R * 0.9, q.y - R * 0.9, Math.max(3, s * 0.13), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (inp.selected.node === n.id || inp.hover.node === n.id) {
        ctx.save();
        ctx.strokeStyle = inp.selected.node === n.id ? '#ffffff' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = inp.selected.node === n.id ? 1.8 : 1.2;
        ctx.setLineDash(inp.selected.node === n.id ? [4, 3] : []);
        ctx.lineDashOffset = inp.reducedMotion ? 0 : -inp.now * 12;
        ctx.beginPath();
        ctx.arc(q.x, q.y, R + s * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private tag(x: number, y: number, text: string, color: string): void {
    const ctx = this.ctx;
    const fs = Math.max(9, Math.min(12, this.camera.scale * 0.3));
    ctx.save();
    ctx.font = `700 ${fs}px ${FONT_MONO}`;
    const w = ctx.measureText(text).width + fs;
    ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
    ctx.fillRect(x - w / 2, y - fs * 0.8, w, fs * 1.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y - fs * 0.8 + 0.5, w - 1, fs * 1.6 - 1);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  private drawEffects(sim: Simulation): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    ctx.save();
    for (const e of sim.effects) {
      if (!e.node) continue;
      const p = this.pos.get(e.node);
      if (!p) continue;
      const q = this.sc(p);
      const age = sim.t - e.t;
      switch (e.kind) {
        case 'drop': {
          const k = age / 0.6;
          if (k > 1) break;
          ctx.strokeStyle = hexAlpha(PAL.crit, 1 - k);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + e.t * 7;
            ctx.moveTo(q.x + Math.cos(a) * s * 0.3, q.y + Math.sin(a) * s * 0.3);
            ctx.lineTo(q.x + Math.cos(a) * s * (0.3 + 0.4 * k), q.y + Math.sin(a) * s * (0.3 + 0.4 * k));
          }
          ctx.stroke();
          break;
        }
        case 'blocked': {
          const k = age / 0.8;
          if (k > 1) break;
          const r = s * (0.5 + 0.5 * k);
          ctx.strokeStyle = hexAlpha(PAL.crit, 0.9 * (1 - k));
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'breach':
        case 'overheat':
        case 'failure':
        case 'infect':
        case 'fixed': {
          const k = age / 1.5;
          if (k > 1) break;
          const color = e.kind === 'fixed' ? PAL.ok : e.kind === 'overheat' ? PAL.warn : PAL.crit;
          ctx.strokeStyle = hexAlpha(color, 1 - k);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(q.x, q.y, s * (0.6 + 1.6 * k), 0, Math.PI * 2);
          ctx.stroke();
          if (e.kind === 'breach' || e.kind === 'fixed') {
            ctx.globalAlpha = 1 - k;
            this.tag(q.x, q.y - s * (1 + k * 0.8), e.kind === 'breach' ? T.map.breach : T.map.fixed, color);
            ctx.globalAlpha = 1;
          }
          break;
        }
        case 'unreach': {
          const k = age / 1.2;
          if (k > 1) break;
          ctx.font = `700 ${Math.max(10, s * 0.4)}px ${FONT_MONO}`;
          ctx.fillStyle = hexAlpha('#aab6c8', 1 - k);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', q.x, q.y - s * (0.5 + 0.5 * k));
          break;
        }
      }
    }
    ctx.restore();
  }

  private drawTechs(inp: RenderInput, sim: Simulation, alpha: number): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const t of sim.techs) {
      if (t.target && (t.state === 'moving' || t.state === 'working')) {
        const target = inp.net.byId.get(t.target);
        if (target) {
          const q = this.sc({ x: target.x, y: target.y });
          if (t.state === 'moving') {
            ctx.strokeStyle = 'rgba(255, 210, 122, 0.45)';
            ctx.setLineDash([2, 4]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const from = this.sc(t);
            ctx.moveTo(from.x, from.y);
            for (const wp of t.path) {
              const w = this.sc(wp);
              ctx.lineTo(w.x, w.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            const k = 1 - t.work / t.workTotal;
            ctx.strokeStyle = '#ffd27a';
            ctx.lineWidth = Math.max(2, s * 0.08);
            ctx.beginPath();
            ctx.arc(q.x, q.y, glyphRadius(target.kind) * s + s * 0.34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
            ctx.stroke();
          }
        }
      }
      const p = this.sc(t);
      const bob = t.state === 'moving' && !inp.reducedMotion ? Math.sin(inp.now * 14) * s * 0.03 : 0;
      ctx.fillStyle = '#ffd27a';
      ctx.strokeStyle = '#05070d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y - s * 0.22 + bob, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - s * 0.17, p.y + s * 0.2 + bob);
      ctx.quadraticCurveTo(p.x, p.y - s * 0.16 + bob, p.x + s * 0.17, p.y + s * 0.2 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGhost(g: Ghost): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const c = this.sc({ x: g.cell.x, y: g.cell.y });
    ctx.save();
    ctx.fillStyle = hexAlpha(g.ok ? PAL.ok : PAL.crit, 0.12);
    ctx.fillRect(c.x, c.y, s, s);
    const q = this.sc({ x: g.cell.x + 0.5, y: g.cell.y + 0.5 });
    const spec = DEVICES[g.kind];
    if (spec.wifi && g.ok) {
      ctx.strokeStyle = 'rgba(111, 214, 255, 0.5)';
      ctx.fillStyle = 'rgba(111, 214, 255, 0.06)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(q.x, q.y, spec.wifi.radius * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawGlyph(ctx, g.kind, q.x, q.y, s, {
      stroke: g.ok ? PAL.ok : PAL.crit,
      fill: PAL.equipFill,
      ports: { used: 0, total: spec.ports },
      alpha: 0.75,
    });
    ctx.restore();
  }

  private drawCablePreview(inp: RenderInput, c: CablePreview): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const from = this.pos.get(c.from);
    if (!from) return;
    const to = c.target ? (this.pos.get(c.target) ?? c.to) : c.to;
    const e = inp.morph;
    const corner = lerp({ x: to.x, y: from.y }, lerp(from, to, 0.5), e);
    const color = c.ok ? (c.kind === 'fiber' ? PAL.fiber : PAL.ok) : PAL.crit;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.setLineDash([s * 0.18, s * 0.12]);
    ctx.lineDashOffset = inp.reducedMotion ? 0 : -inp.now * 20;
    this.strokePoly([from, corner, to]);
    ctx.setLineDash([]);
    const q = this.sc(to);
    ctx.font = `500 ${Math.max(10, Math.min(12, s * 0.34))}px ${FONT_MONO}`;
    const w = ctx.measureText(c.label).width + 12;
    const x = Math.min(this.w - w - 4, q.x + 14);
    const y = Math.max(4, q.y - 30);
    ctx.fillStyle = 'rgba(5, 7, 13, 0.92)';
    ctx.fillRect(x, y, w, 20);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 19);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.label, x + 6, y + 10.5);
    ctx.restore();
  }

  private drawLabels(inp: RenderInput): void {
    const ctx = this.ctx;
    const s = this.camera.scale;
    const sim = inp.sim;
    const zoomed = this.camera.zoomed || s > 40;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const free = (x0: number, x1: number, y0: number, y1: number) =>
      placed.every((r) => x1 < r.x0 || x0 > r.x1 || y1 < r.y0 || y0 > r.y1);
    // Hovered or selected labels go first, then active equipment.
    const order = [...inp.net.nodes].sort((a, b) => {
      const fa = inp.hover.node === a.id || inp.selected.node === a.id ? 0 : a.transit ? 1 : 2;
      const fb = inp.hover.node === b.id || inp.selected.node === b.id ? 0 : b.transit ? 1 : 2;
      return fa - fb;
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of order) {
      const always = n.transit || n.kind === 'server' || n.kind === 'internet';
      const focus = inp.hover.node === n.id || inp.selected.node === n.id;
      if (!always && !focus && !zoomed) continue;
      const p = this.sc(this.pos.get(n.id)!);
      const R = glyphRadius(n.kind) * s;
      const fs = Math.max(8.5, Math.min(12, s * 0.28));
      ctx.font = `500 ${fs}px ${FONT_MONO}`;
      const st = sim?.states.get(n.id);
      const extra = st && st.up && (n.transit || n.kind === 'server') && (inp.snmp || focus)
        ? `${Math.round(Math.min(1, st.load) * 100)}% · ${tempCelsius(st.heat)}°C`
        : '';
      const w = Math.max(ctx.measureText(n.label).width, extra ? ctx.measureText(extra).width : 0) + 4;
      const h = fs * (extra ? 2.3 : 1.15);
      let y = p.y + R + s * 0.14;
      let ok = free(p.x - w / 2, p.x + w / 2, y, y + h);
      for (let k = 0; !ok && k < 2; k++) {
        y += fs * 1.2;
        ok = free(p.x - w / 2, p.x + w / 2, y, y + h);
      }
      if (!ok && !focus) continue;
      placed.push({ x0: p.x - w / 2, x1: p.x + w / 2, y0: y, y1: y + h });
      ctx.fillStyle = focus ? '#ffffff' : 'rgba(190, 206, 230, 0.78)';
      ctx.fillText(n.label, p.x, y);
      if (extra) {
        ctx.fillStyle = loadColor(st!.load);
        ctx.fillText(extra, p.x, y + fs * 1.15);
      }
    }
    ctx.restore();
  }
}
