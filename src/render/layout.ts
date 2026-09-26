// Topology view: a tree rooted at the Internet, ordered like the floor plan (left → right) so that
// the morph between the two views stays readable.

import { otherEnd, type Network } from '../core/network.ts';
import type { Vec } from '../core/types.ts';

const LEAVES_PER_ROW = 6;

interface TreeNode {
  id: string;
  children: TreeNode[];
  leaves: string[];
  width: number;
  depth: number;
}

export function topologyLayout(net: Network, size: { w: number; h: number }): Map<string, Vec> {
  const out = new Map<string, Vec>();
  const byX = (a: string, b: string) => {
    const na = net.byId.get(a)!;
    const nb = net.byId.get(b)!;
    return na.x - nb.x || na.y - nb.y || a.localeCompare(b);
  };

  const visited = new Set<string>();
  const neighbours = (id: string) =>
    [...new Set((net.adj.get(id) ?? []).map((l) => otherEnd(l, id)))].sort(byX);

  const build = (rootId: string): TreeNode => {
    // Breadth-first search: each node hangs from the first parent that discovers it.
    const root: TreeNode = { id: rootId, children: [], leaves: [], width: 1, depth: 1 };
    visited.add(rootId);
    const queue: TreeNode[] = [root];
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      const node = net.byId.get(t.id)!;
      if (node.endpoint && t !== root) continue;
      for (const m of neighbours(t.id)) {
        if (visited.has(m)) continue;
        visited.add(m);
        const mn = net.byId.get(m)!;
        if (mn.endpoint && mn.kind !== 'internet') {
          t.leaves.push(m);
        } else {
          const child: TreeNode = { id: m, children: [], leaves: [], width: 1, depth: 1 };
          t.children.push(child);
          queue.push(child);
        }
      }
    }
    return root;
  };

  const measure = (t: TreeNode): void => {
    for (const c of t.children) measure(c);
    const cols = Math.min(LEAVES_PER_ROW, t.leaves.length);
    const rows = Math.ceil(t.leaves.length / LEAVES_PER_ROW);
    const childWidth = t.children.reduce((s, c) => s + c.width, 0);
    t.width = Math.max(1, childWidth + cols);
    const childDepth = t.children.reduce((m, c) => Math.max(m, c.depth), 0);
    t.depth = 1 + Math.max(childDepth, rows * 0.7);
  };

  const roots: TreeNode[] = [];
  const internet = net.nodes.filter((n) => n.kind === 'internet').map((n) => n.id);
  for (const id of internet) roots.push(build(id));
  const equipment = net.nodes.filter((n) => n.transit).map((n) => n.id).sort(byX);
  for (const id of equipment) if (!visited.has(id)) roots.push(build(id));
  const orphans = net.nodes.filter((n) => !visited.has(n.id)).map((n) => n.id).sort(byX);

  for (const r of roots) measure(r);
  const totalW = Math.max(1, roots.reduce((s, r) => s + r.width, 0));
  const maxDepth = Math.max(1, ...roots.map((r) => r.depth));
  const usableH = size.h - (orphans.length ? 3.2 : 1.6);
  const unitX = Math.min(2.6, (size.w - 2) / totalW);
  const unitY = Math.min(3.6, usableH / maxDepth);
  const x0 = (size.w - totalW * unitX) / 2;
  const y0 = 1.2;

  const place = (t: TreeNode, left: number, depth: number): void => {
    const center = left + (t.width * unitX) / 2;
    out.set(t.id, { x: center, y: y0 + depth * unitY });
    let cursor = left;
    for (const c of t.children) {
      place(c, cursor, depth + 1);
      cursor += c.width * unitX;
    }
    if (t.leaves.length) {
      const cols = Math.min(LEAVES_PER_ROW, t.leaves.length);
      const leaves = [...t.leaves].sort(byX);
      leaves.forEach((id, i) => {
        const row = Math.floor(i / LEAVES_PER_ROW);
        const inRow = Math.min(cols, leaves.length - row * LEAVES_PER_ROW);
        const col = i % LEAVES_PER_ROW;
        const rowLeft = cursor + ((cols - inRow) * unitX) / 2;
        out.set(id, { x: rowLeft + (col + 0.5) * unitX, y: y0 + (depth + 1 + row * 0.7) * unitY });
      });
    }
  };

  let left = x0;
  for (const r of roots) {
    place(r, left, 0);
    left += r.width * unitX;
  }

  if (orphans.length) {
    const step = Math.min(1.6, (size.w - 2) / orphans.length);
    const start = (size.w - step * (orphans.length - 1)) / 2;
    orphans.forEach((id, i) => out.set(id, { x: start + i * step, y: size.h - 0.9 }));
  }
  return out;
}
