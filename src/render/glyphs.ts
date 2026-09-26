// Vector glyphs of the equipment, drawn on the canvas (s = pixels per cell).

import type { NodeKind } from '../core/types.ts';

export const PAL = {
  bg: '#05070d',
  grid: 'rgba(120, 150, 205, 0.09)',
  roomFill: 'rgba(130, 160, 215, 0.035)',
  roomLine: 'rgba(130, 160, 215, 0.24)',
  roomLabel: 'rgba(165, 185, 222, 0.62)',
  serverRoom: 'rgba(70, 140, 255, 0.075)',
  equipStroke: '#d3e2fb',
  equipFill: '#0b1321',
  endpointFill: '#090e17',
  rj45: '#2c4468',
  fiber: '#27c4d6',
  wifi: 'rgba(125, 200, 255, 0.4)',
  ok: '#3ee39c',
  warn: '#ffb547',
  crit: '#ff3d5a',
  accent: '#ff7ac6',
  dim: '#5e708c',
  text: '#d7e3f4',
};

export const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
export const FONT_UI = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_DISPLAY = '"Oxanium", "IBM Plex Sans", system-ui, sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, head: number): void {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.moveTo(x2 - head * Math.cos(ang - 0.55), y2 - head * Math.sin(ang - 0.55));
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang + 0.55), y2 - head * Math.sin(ang + 0.55));
}

export interface GlyphStyle {
  stroke: string;
  fill: string;
  ports?: { used: number; total: number };
  alpha?: number;
}

/** Approximate picking radius (in cells) of each glyph. */
export function glyphRadius(kind: NodeKind): number {
  switch (kind) {
    case 'internet':
      return 0.75;
    case 'switch8':
    case 'switch24':
    case 'switch_l3':
      return 0.72;
    case 'router':
    case 'router_pro':
      return 0.55;
    case 'server':
      return 0.45;
    case 'ap':
      return 0.42;
    default:
      return 0.38;
  }
}

export function drawGlyph(ctx: CanvasRenderingContext2D, kind: NodeKind, x: number, y: number, s: number, st: GlyphStyle): void {
  ctx.save();
  ctx.globalAlpha *= st.alpha ?? 1;
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.strokeStyle = st.stroke;
  ctx.fillStyle = st.fill;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (kind) {
    case 'workstation': {
      const w = s * 0.6;
      const h = s * 0.4;
      roundRect(ctx, x - w / 2, y - h / 2 - s * 0.08, w, h, s * 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2 - s * 0.08);
      ctx.lineTo(x, y + s * 0.2);
      ctx.moveTo(x - s * 0.14, y + s * 0.22);
      ctx.lineTo(x + s * 0.14, y + s * 0.22);
      ctx.stroke();
      break;
    }
    case 'laptop': {
      const w = s * 0.46;
      const h = s * 0.3;
      roundRect(ctx, x - w / 2, y - h / 2 - s * 0.06, w, h, s * 0.04);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.32, y + s * 0.16);
      ctx.lineTo(x + s * 0.32, y + s * 0.16);
      ctx.stroke();
      break;
    }
    case 'server': {
      const w = s * 0.56;
      const h = s * 0.74;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, s * 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        const yy = y - h / 2 + (h * i) / 3;
        ctx.moveTo(x - w / 2 + s * 0.06, yy);
        ctx.lineTo(x + w / 2 - s * 0.06, yy);
      }
      ctx.stroke();
      ctx.fillStyle = st.stroke;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x + w / 2 - s * 0.12, y - h / 2 + (h * (i + 0.5)) / 3, s * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'internet': {
      const r = s * 0.62;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.45, r, 0, 0, Math.PI * 2);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x - r * 0.86, y - r * 0.5);
      ctx.lineTo(x + r * 0.86, y - r * 0.5);
      ctx.moveTo(x - r * 0.86, y + r * 0.5);
      ctx.lineTo(x + r * 0.86, y + r * 0.5);
      ctx.stroke();
      break;
    }
    case 'switch8':
    case 'switch24':
    case 'switch_l3': {
      const w = s * (kind === 'switch8' ? 1.2 : 1.36);
      const h = s * 0.5;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, s * 0.08);
      ctx.fill();
      ctx.stroke();
      if (kind === 'switch_l3') {
        roundRect(ctx, x - w / 2 + s * 0.07, y - h / 2 + s * 0.07, w - s * 0.14, h - s * 0.14, s * 0.05);
        ctx.stroke();
      }
      const total = st.ports?.total ?? 8;
      const shown = Math.min(total, kind === 'switch8' ? 8 : 12);
      const used = Math.min(shown, st.ports?.used ?? 0);
      const gap = (w - s * 0.3) / shown;
      for (let i = 0; i < shown; i++) {
        ctx.beginPath();
        ctx.fillStyle = i < used ? st.stroke : 'rgba(210, 226, 251, 0.18)';
        ctx.arc(x - w / 2 + s * 0.15 + gap * (i + 0.5), y + h * 0.12, s * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      if (kind === 'switch_l3') {
        ctx.fillStyle = st.stroke;
        ctx.font = `600 ${Math.max(7, s * 0.2)}px ${FONT_MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('L3', x, y - h * 0.16);
      }
      break;
    }
    case 'router':
    case 'router_pro': {
      const r = s * (kind === 'router' ? 0.46 : 0.52);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (kind === 'router_pro') {
        ctx.beginPath();
        ctx.arc(x, y, r - s * 0.08, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Four arrows, two in and two out: the classic router symbol.
      const inner = r * 0.14;
      const outer = r * 0.62;
      const head = r * 0.2;
      ctx.beginPath();
      arrow(ctx, x + inner, y, x + outer, y, head);
      arrow(ctx, x - outer, y, x - inner, y, head);
      arrow(ctx, x, y - inner, x, y - outer, head);
      arrow(ctx, x, y + outer, x, y + inner, head);
      ctx.stroke();
      break;
    }
    case 'ap': {
      const r = s * 0.2;
      ctx.beginPath();
      ctx.arc(x, y + s * 0.12, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + s * 0.12, s * 0.36, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + s * 0.12, s * 0.52, -Math.PI * 0.74, -Math.PI * 0.26);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Pre-rendered glow sprite for a color (drawn in additive mode). */
export function glowSprite(color: string, size = 48): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, color);
  grad.addColorStop(0.42, hexAlpha(color, 0.35));
  grad.addColorStop(1, hexAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (m) => m + m) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Green → amber → red for a load in 0..1. */
export function loadColor(load: number): string {
  if (load < 0.6) return PAL.ok;
  if (load < 0.85) return mix(PAL.ok, PAL.warn, (load - 0.6) / 0.25);
  return mix(PAL.warn, PAL.crit, Math.min(1, (load - 0.85) / 0.15));
}
