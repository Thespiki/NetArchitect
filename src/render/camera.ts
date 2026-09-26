// Caméra 2D : unités monde = cases de la grille, écran = pixels CSS.

import type { Vec } from '../core/types.ts';

export class Camera {
  scale = 32;
  ox = 0;
  oy = 0;
  private fitScale = 32;

  fit(viewW: number, viewH: number, worldW: number, worldH: number, margin = 24): void {
    const s = Math.max(4, Math.min((viewW - margin * 2) / worldW, (viewH - margin * 2) / worldH));
    this.scale = s;
    this.fitScale = s;
    this.ox = (viewW - worldW * s) / 2;
    this.oy = (viewH - worldH * s) / 2;
  }

  toScreen(x: number, y: number): Vec {
    return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
  }

  toWorld(px: number, py: number): Vec {
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  zoomAt(px: number, py: number, factor: number): void {
    const next = Math.max(this.fitScale * 0.6, Math.min(this.fitScale * 4, this.scale * factor));
    const w = this.toWorld(px, py);
    this.scale = next;
    this.ox = px - w.x * next;
    this.oy = py - w.y * next;
  }

  pan(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
  }

  get zoomed(): boolean {
    return this.scale > this.fitScale * 1.05;
  }
}
