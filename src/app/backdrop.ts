// Fond animé de l'écran titre : un réseau abstrait où circulent des paquets néon.

import { TRAFFIC } from '../core/catalog.ts';
import { Rng } from '../core/rng.ts';
import { glowSprite, PAL } from '../render/glyphs.ts';

interface Pt {
  x: number;
  y: number;
}

export function mountBackdrop(canvas: HTMLCanvasElement, still: boolean): () => void {
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(7);
  const colors = [TRAFFIC.web.color, TRAFFIC.web.color, TRAFFIC.stream.color, TRAFFIC.data.color, TRAFFIC.attack.color];
  const sprites = colors.map((c) => glowSprite(c));
  let nodes: Pt[] = [];
  let edges: [number, number][] = [];
  let packets: { e: number; f: number; v: number; c: number; dir: number }[] = [];
  let w = 0;
  let h = 0;
  let raf = 0;

  const build = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(18, Math.round((w * h) / 26000));
    nodes = [];
    for (let i = 0; i < count; i++) nodes.push({ x: rng.range(0.03, 0.97) * w, y: rng.range(0.05, 0.95) * h });
    edges = [];
    for (let i = 0; i < nodes.length; i++) {
      const near = nodes
        .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
        .filter((o) => o.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      for (const o of near) if (!edges.some(([a, b]) => (a === i && b === o.j) || (a === o.j && b === i))) edges.push([i, o.j]);
    }
    packets = [];
    for (let i = 0; i < edges.length * 1.4; i++) {
      packets.push({ e: rng.int(edges.length), f: rng.next(), v: rng.range(0.08, 0.3), c: rng.int(colors.length), dir: rng.chance(0.5) ? 1 : -1 });
    }
  };

  const draw = (dt: number) => {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(80, 110, 160, 0.22)';
    ctx.beginPath();
    for (const [a, b] of edges) {
      ctx.moveTo(nodes[a].x, nodes[a].y);
      ctx.lineTo(nodes[a].x, nodes[b].y);
      ctx.lineTo(nodes[b].x, nodes[b].y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(200, 220, 250, 0.35)';
    for (const n of nodes) ctx.fillRect(n.x - 2, n.y - 2, 4, 4);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of packets) {
      p.f += p.dir * p.v * dt;
      if (p.f > 1 || p.f < 0) {
        p.e = rng.int(edges.length);
        p.f = p.dir > 0 ? 0 : 1;
        p.c = rng.chance(0.06) ? colors.length - 1 : rng.int(colors.length - 1);
      }
      const [a, b] = edges[p.e];
      const A = nodes[a];
      const B = nodes[b];
      const l1 = Math.abs(B.y - A.y);
      const l2 = Math.abs(B.x - A.x);
      const d = p.f * (l1 + l2);
      const x = d < l1 ? A.x : A.x + Math.sign(B.x - A.x) * (d - l1);
      const y = d < l1 ? A.y + Math.sign(B.y - A.y) * d : B.y;
      const s = 16;
      ctx.drawImage(sprites[p.c], x - s / 2, y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  let last = performance.now();
  const loop = (ts: number) => {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    draw(dt);
    raf = requestAnimationFrame(loop);
  };

  build();
  if (still) draw(0);
  else raf = requestAnimationFrame(loop);
  const ro = new ResizeObserver(() => {
    build();
    if (still) draw(0);
  });
  ro.observe(canvas);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
