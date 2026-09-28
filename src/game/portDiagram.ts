// Tiny canvas diagram of a part's footprint with its ports at a given rotation.

import { DIR_VECS, footprint, rotatedPorts } from '../shared/geometry';
import type { Dir, PartType, PortKind, Rotation } from '../shared/types';

const COLOR: Record<PortKind, string> = { in: '#5ad17a', out: '#5aa9f0', byproduct: '#f0a94a', reject: '#ef6161' };
const LABEL: Record<PortKind, string> = { in: 'in', out: 'out', byproduct: 'byproduct', reject: 'reject' };

export const DIAGRAM_W = 180;
export const DIAGRAM_H = 132;

export function drawPortDiagram(canvas: HTMLCanvasElement, type: PartType, rot: Rotation): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${DIAGRAM_W}px`;
  canvas.style.height = `${DIAGRAM_H}px`;
  canvas.width = Math.round(DIAGRAM_W * dpr);
  canvas.height = Math.round(DIAGRAM_H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, DIAGRAM_W, DIAGRAM_H);

  const { w, h } = footprint(type, rot);
  const mx = 40, my = 26;
  const c = Math.floor(Math.min((DIAGRAM_W - 2 * mx) / w, (DIAGRAM_H - 2 * my) / h, 30));
  const ox = Math.round((DIAGRAM_W - c * w) / 2), oy = Math.round((DIAGRAM_H - c * h) / 2);

  ctx.fillStyle = '#33404f';
  ctx.beginPath();
  ctx.roundRect(ox, oy, w * c, h * c, 4);
  ctx.fill();
  ctx.strokeStyle = '#6b8199';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < w; x++) { ctx.moveTo(ox + x * c, oy); ctx.lineTo(ox + x * c, oy + h * c); }
  for (let y = 1; y < h; y++) { ctx.moveTo(ox, oy + y * c); ctx.lineTo(ox + w * c, oy + y * c); }
  ctx.stroke();

  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const p of rotatedPorts(type, rot)) {
    const v = DIR_VECS[p.side]!;
    const ex = ox + (p.dx + 0.5 + v.x * 0.5) * c, ey = oy + (p.dy + 0.5 + v.y * 0.5) * c;
    const dir: Dir = p.kind === 'in' ? (((p.side + 2) % 4) as Dir) : p.side;
    const d = DIR_VECS[dir]!;
    const px = -d.y, py = d.x, sz = 6;
    // arrow straddling the edge
    ctx.fillStyle = COLOR[p.kind];
    ctx.beginPath();
    ctx.moveTo(ex + d.x * sz, ey + d.y * sz);
    ctx.lineTo(ex - d.x * sz * 0.7 + px * sz * 0.8, ey - d.y * sz * 0.7 + py * sz * 0.8);
    ctx.lineTo(ex - d.x * sz * 0.7 - px * sz * 0.8, ey - d.y * sz * 0.7 - py * sz * 0.8);
    ctx.closePath();
    ctx.fill();
    // label just outside
    const lx = ex + v.x * 12, ly = ey + v.y * 12;
    ctx.textAlign = v.x > 0 ? 'left' : v.x < 0 ? 'right' : 'center';
    ctx.textBaseline = v.y > 0 ? 'top' : v.y < 0 ? 'bottom' : 'middle';
    ctx.fillText(LABEL[p.kind], lx + (v.y !== 0 ? 0 : v.x * 2), ly);
  }
}
