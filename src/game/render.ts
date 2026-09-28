// Canvas 2D rendering of the floor. Stateless apart from layout; call draw() each frame.

import { ITEMS, RECIPES } from '../shared/catalog';
import { DIR_VECS, footprint, placementPorts, placementTiles, step, vecKey } from '../shared/geometry';
import { highlightTiles } from './highlight';
import { requiredDeliveries } from '../shared/puzzle';
import type { Dir, Placement, PortDef, Puzzle, Vec } from '../shared/types';
import type { LayoutError, SimSnapshot } from '../sim/api';

export interface GhostPart {
  placement: Placement;
  valid: boolean;
}

export interface DrawView {
  puzzle: Puzzle;
  placements: readonly Placement[];
  selected: ReadonlySet<number>;
  ghosts: GhostPart[];
  hover: Vec | null;
  selBox: { a: Vec; b: Vec } | null;
  errors: LayoutError[];
  snapshot: SimSnapshot | null;
  /** 0..1 progress between the previous and current tick. */
  alpha: number;
  /** Highlight tiles of placements moved onto invalid spots etc. */
  flashTiles?: ReadonlySet<string>;
  timeMs: number;
  /** Item hovered in the recipe panel; tiles carrying or producing it are highlighted. */
  highlightItem?: string | null;
  /** Placement index to flash (e.g. after clicking a deadlock line); null when none. */
  flashPlacement?: number | null;
}

const C = {
  bg: '#14171c',
  grid: '#232830',
  cell: '#1a1e25',
  edge: '#101318',
  edgeLine: '#2f3742',
  terrain: '#3b3f47',
  terrainHatch: '#2b2e35',
  belt: '#2c333d',
  beltLine: '#6f7d8f',
  arrow: '#c9d3df',
  machine: '#33404f',
  machineEdge: '#6b8199',
  text: '#dfe6ee',
  in: '#5ad17a',
  out: '#5aa9f0',
  byproduct: '#f0a94a',
  reject: '#ef6161',
  bad: '#ff4d4d',
  sel: '#ffd24d',
  jam: '#ff3b3b',
  deadlock: '#ffb020',
};

const PORT_COLOR: Record<PortDef['kind'], string> = {
  in: C.in,
  out: C.out,
  byproduct: C.byproduct,
  reject: C.reject,
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  cell = 32;
  ox = 0;
  oy = 0;
  private cssW = 0;
  private cssH = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private puzzle: Puzzle,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Match backing store to the element's CSS size at devicePixelRatio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.cell = Math.max(8, Math.floor(Math.min(this.cssW / this.puzzle.width, this.cssH / this.puzzle.height)));
    this.ox = Math.floor((this.cssW - this.cell * this.puzzle.width) / 2);
    this.oy = Math.floor((this.cssH - this.cell * this.puzzle.height) / 2);
  }

  /** Grid tile under a client-space point (may be out of bounds). */
  tileAt(clientX: number, clientY: number): Vec {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((clientX - r.left - this.ox) / this.cell),
      y: Math.floor((clientY - r.top - this.oy) / this.cell),
    };
  }

  draw(v: DrawView): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    const s = this.cell;
    const { width, height } = v.puzzle;

    // floor
    ctx.fillStyle = C.cell;
    ctx.fillRect(0, 0, width * s, height * s);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x++) {
      ctx.moveTo(x * s + 0.5, 0);
      ctx.lineTo(x * s + 0.5, height * s);
    }
    for (let y = 0; y <= height; y++) {
      ctx.moveTo(0, y * s + 0.5);
      ctx.lineTo(width * s, y * s + 0.5);
    }
    ctx.stroke();

    // Outer ring is port-only: darken it and outline the buildable interior.
    ctx.fillStyle = C.edge;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, width * s, s);
    ctx.fillRect(0, (height - 1) * s, width * s, s);
    ctx.fillRect(0, s, s, (height - 2) * s);
    ctx.fillRect((width - 1) * s, s, s, (height - 2) * s);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.edgeLine;
    ctx.lineWidth = 2;
    ctx.strokeRect(s, s, (width - 2) * s, (height - 2) * s);

    for (const t of v.puzzle.terrain) this.drawTerrain(t);
    for (const d of v.puzzle.disposals) this.drawDisposal(d.pos, d.dir);
    for (const src of v.puzzle.sources) this.drawSource(src.pos, src.dir, src.item, src.rate);
    for (const d of v.puzzle.demands) {
      const idx = v.puzzle.demands.indexOf(d);
      const dv = v.snapshot?.demands[idx];
      this.drawDemand(d.pos, d.dir, d.item, d.rate, dv ? dv.deliveredInWindow : null, v.puzzle.windowTicks);
    }

    const feeders = this.feederMap(v.puzzle, v.placements);
    v.placements.forEach((p, i) => {
      this.drawPlacement(p, { feeders });
      const mv = v.snapshot?.machines.find((m) => m.placement === i);
      if (mv) this.drawMachineState(p, mv.progress, mv.craftTicks, mv.stalled, mv.deadlocked, v.timeMs);
    });

    // jams
    if (v.snapshot) {
      const pulse = 0.5 + 0.5 * Math.sin(v.timeMs / 120);
      for (const j of v.snapshot.jams) {
        ctx.fillStyle = `rgba(255,59,59,${0.25 + 0.25 * pulse})`;
        ctx.fillRect(j.pos.x * s, j.pos.y * s, s, s);
        ctx.strokeStyle = C.jam;
        ctx.lineWidth = 2;
        ctx.strokeRect(j.pos.x * s + 1, j.pos.y * s + 1, s - 2, s - 2);
      }
      this.drawItems(v.snapshot, v.alpha);
    }

    if (v.highlightItem) {
      ctx.fillStyle = 'rgba(255,210,77,0.28)';
      ctx.strokeStyle = C.sel;
      ctx.lineWidth = 2;
      for (const k of highlightTiles(v.puzzle, v.placements, v.highlightItem, v.snapshot)) {
        const [hx, hy] = k.split(',').map(Number) as [number, number];
        ctx.fillRect(hx * s, hy * s, s, s);
        ctx.strokeRect(hx * s + 1, hy * s + 1, s - 2, s - 2);
      }
    }

    // layout errors
    for (const e of v.errors) {
      if (e.placement !== undefined && v.placements[e.placement]) {
        for (const t of placementTiles(v.placements[e.placement]!)) this.outline(t, 1, 1, C.bad, 2);
      } else if (e.pos) {
        this.outline(e.pos, 1, 1, C.bad, 2);
      }
    }

    if (v.flashPlacement != null) {
      const p = v.placements[v.flashPlacement];
      if (p) {
        const { w, h } = footprint(p.type, p.rot);
        const f = 0.5 + 0.5 * Math.sin(v.timeMs / 70);
        ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.3 * f})`;
        ctx.fillRect(p.pos.x * s, p.pos.y * s, w * s, h * s);
        this.outline({ x: p.pos.x - 0.1, y: p.pos.y - 0.1 }, w + 0.2, h + 0.2, '#ffffff', 3);
      }
    }

    // selection
    v.selected.forEach((i) => {
      const p = v.placements[i];
      if (!p) return;
      const { w, h } = footprint(p.type, p.rot);
      this.outline(p.pos, w, h, C.sel, 2, [5, 3]);
    });

    if (v.hover && v.hover.x >= 0 && v.hover.y >= 0 && v.hover.x < width && v.hover.y < height) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(v.hover.x * s, v.hover.y * s, s, s);
    }

    for (const g of v.ghosts) {
      this.drawPlacement(g.placement, { alpha: 0.6, tint: g.valid ? null : C.bad });
    }

    if (v.selBox) {
      const x0 = Math.min(v.selBox.a.x, v.selBox.b.x), x1 = Math.max(v.selBox.a.x, v.selBox.b.x);
      const y0 = Math.min(v.selBox.a.y, v.selBox.b.y), y1 = Math.max(v.selBox.a.y, v.selBox.b.y);
      ctx.fillStyle = 'rgba(255,210,77,0.12)';
      ctx.fillRect(x0 * s, y0 * s, (x1 - x0 + 1) * s, (y1 - y0 + 1) * s);
      this.outline({ x: x0, y: y0 }, x1 - x0 + 1, y1 - y0 + 1, C.sel, 1, [4, 3]);
    }
    ctx.restore();
  }

  // ---------- helpers ----------

  private outline(p: Vec, w: number, h: number, color: string, lw: number, dash: number[] = []): void {
    const ctx = this.ctx, s = this.cell;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.strokeRect(p.x * s + lw / 2, p.y * s + lw / 2, w * s - lw, h * s - lw);
    ctx.restore();
  }

  private drawTerrain(t: Vec): void {
    const ctx = this.ctx, s = this.cell;
    ctx.fillStyle = C.terrain;
    ctx.fillRect(t.x * s, t.y * s, s, s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(t.x * s, t.y * s, s, s);
    ctx.clip();
    ctx.strokeStyle = C.terrainHatch;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = -s; k < s; k += s / 3) {
      ctx.moveTo(t.x * s + k, t.y * s + s);
      ctx.lineTo(t.x * s + k + s, t.y * s);
    }
    ctx.stroke();
    ctx.restore();
  }

  private arrow(cx: number, cy: number, dir: Dir, size: number, color: string): void {
    const ctx = this.ctx;
    const v = DIR_VECS[dir]!;
    const px = -v.y, py = v.x;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + v.x * size, cy + v.y * size);
    ctx.lineTo(cx - v.x * size * 0.7 + px * size * 0.8, cy - v.y * size * 0.7 + py * size * 0.8);
    ctx.lineTo(cx - v.x * size * 0.7 - px * size * 0.8, cy - v.y * size * 0.7 - py * size * 0.8);
    ctx.closePath();
    ctx.fill();
  }

  private itemDot(cx: number, cy: number, item: string, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = ITEMS[item]?.color ?? '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private rateText(r: { count: number; ticks: number }): string {
    return `${r.count}/${r.ticks}t`;
  }

  private drawSource(pos: Vec, dir: Dir, item: string, rate: { count: number; ticks: number }): void {
    const ctx = this.ctx, s = this.cell;
    ctx.fillStyle = '#20282f';
    ctx.fillRect(pos.x * s + 1, pos.y * s + 1, s - 2, s - 2);
    ctx.strokeStyle = ITEMS[item]?.color ?? '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(pos.x * s + 2, pos.y * s + 2, s - 4, s - 4);
    this.itemDot((pos.x + 0.4) * s, (pos.y + 0.4) * s, item, s * 0.2);
    this.arrow((pos.x + 0.5) * s + DIR_VECS[dir]!.x * s * 0.28, (pos.y + 0.5) * s + DIR_VECS[dir]!.y * s * 0.28, dir, s * 0.16, C.arrow);
    ctx.fillStyle = C.text;
    ctx.font = `${Math.max(8, s * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(this.rateText(rate), (pos.x + 0.5) * s, (pos.y + 0.95) * s);
  }

  private drawDemand(
    pos: Vec,
    dir: Dir,
    item: string,
    rate: { count: number; ticks: number },
    got: number | null,
    windowTicks: number,
  ): void {
    const ctx = this.ctx, s = this.cell;
    ctx.fillStyle = '#1f2a24';
    ctx.fillRect(pos.x * s + 1, pos.y * s + 1, s - 2, s - 2);
    ctx.strokeStyle = C.in;
    ctx.lineWidth = 2;
    ctx.strokeRect(pos.x * s + 2, pos.y * s + 2, s - 4, s - 4);
    this.itemDot((pos.x + 0.5) * s, (pos.y + 0.42) * s, item, s * 0.22);
    // little arrow on the accepting side pointing into the port
    const v = DIR_VECS[dir]!;
    this.arrow((pos.x + 0.5 + v.x * 0.36) * s, (pos.y + 0.5 + v.y * 0.36) * s, ((dir + 2) % 4) as Dir, s * 0.13, C.in);
    ctx.fillStyle = C.text;
    ctx.font = `${Math.max(8, s * 0.26)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const required = requiredDeliveries(rate, windowTicks);
    ctx.fillText(got === null ? this.rateText(rate) : `${got}/${required}`, (pos.x + 0.5) * s, (pos.y + 0.95) * s);
  }

  private drawDisposal(pos: Vec, dir: Dir): void {
    const ctx = this.ctx, s = this.cell;
    ctx.fillStyle = '#2a1f1f';
    ctx.fillRect(pos.x * s + 1, pos.y * s + 1, s - 2, s - 2);
    ctx.strokeStyle = C.reject;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo((pos.x + 0.3) * s, (pos.y + 0.3) * s);
    ctx.lineTo((pos.x + 0.7) * s, (pos.y + 0.7) * s);
    ctx.moveTo((pos.x + 0.7) * s, (pos.y + 0.3) * s);
    ctx.lineTo((pos.x + 0.3) * s, (pos.y + 0.7) * s);
    ctx.stroke();
    const v = DIR_VECS[dir]!;
    this.arrow((pos.x + 0.5 + v.x * 0.38) * s, (pos.y + 0.5 + v.y * 0.38) * s, ((dir + 2) % 4) as Dir, s * 0.12, C.reject);
  }

  /** For each tile, the directions (from that tile) of neighbours feeding into it. */
  private feederMap(puzzle: Puzzle, placements: readonly Placement[]): Map<string, Dir[]> {
    const m = new Map<string, Dir[]>();
    const add = (target: Vec, from: Vec) => {
      const dx = from.x - target.x, dy = from.y - target.y;
      const d: Dir | null = dy === -1 ? 0 : dx === 1 ? 1 : dy === 1 ? 2 : dx === -1 ? 3 : null;
      if (d === null || Math.abs(dx) + Math.abs(dy) !== 1) return;
      const k = vecKey(target);
      const arr = m.get(k) ?? [];
      arr.push(d);
      m.set(k, arr);
    };
    for (const p of placements) {
      if (p.type === 'belt' || p.type === 'merger') add(step(p.pos, p.rot), p.pos);
      else if (p.type === 'splitter') {
        for (const d of [0, 1, 2, 3] as Dir[]) if (d !== (p.rot + 2) % 4) add(step(p.pos, d), p.pos);
      } else for (const port of placementPorts(p)) if (port.kind !== 'in') add(port.neighbor, port.tile);
    }
    for (const s of puzzle.sources) add(step(s.pos, s.dir), s.pos);
    return m;
  }

  drawPlacement(
    p: Placement,
    o: { alpha?: number; tint?: string | null; feeders?: Map<string, Dir[]> } = {},
  ): void {
    const ctx = this.ctx, s = this.cell;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    const { w, h } = footprint(p.type, p.rot);
    const x = p.pos.x * s, y = p.pos.y * s;

    if (p.type === 'belt') {
      ctx.fillStyle = C.belt;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      const front = p.rot;
      const back = ((p.rot + 2) % 4) as Dir;
      const feeds = o.feeders?.get(vecKey(p.pos)) ?? [];
      let inDir: Dir = back;
      if (o.feeders && !feeds.includes(back) && feeds.length) inDir = feeds.find((d) => d !== front) ?? back;
      const cx = x + s / 2, cy = y + s / 2;
      ctx.strokeStyle = C.beltLine;
      ctx.lineWidth = Math.max(2, s * 0.14);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const vi = DIR_VECS[inDir]!, vf = DIR_VECS[front]!;
      ctx.moveTo(cx + vi.x * s * 0.5, cy + vi.y * s * 0.5);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + vf.x * s * 0.5, cy + vf.y * s * 0.5);
      ctx.stroke();
      this.arrow(cx + vf.x * s * 0.12, cy + vf.y * s * 0.12, front, s * 0.2, C.arrow);
    } else if (p.type === 'merger' || p.type === 'splitter') {
      ctx.fillStyle = p.type === 'merger' ? '#3a3548' : '#354845';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = p.type === 'merger' ? '#a58cf0' : '#5fd6c8';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
      const cx = x + s / 2, cy = y + s / 2;
      for (const d of [0, 1, 2, 3] as Dir[]) {
        const isFront = d === p.rot;
        const isBack = d === (p.rot + 2) % 4;
        const v = DIR_VECS[d]!;
        if (p.type === 'merger') {
          if (isFront) this.arrow(cx + v.x * s * 0.3, cy + v.y * s * 0.3, d, s * 0.14, C.arrow);
          else this.arrow(cx + v.x * s * 0.3, cy + v.y * s * 0.3, ((d + 2) % 4) as Dir, s * 0.1, '#a58cf0');
        } else {
          if (isBack) this.arrow(cx + v.x * s * 0.3, cy + v.y * s * 0.3, ((d + 2) % 4) as Dir, s * 0.1, C.arrow);
          else this.arrow(cx + v.x * s * 0.3, cy + v.y * s * 0.3, d, s * 0.14, '#5fd6c8');
        }
      }
    } else {
      // multi-tile: sorter + machines
      const isSorter = p.type === 'sorter';
      ctx.fillStyle = isSorter ? '#3d3a2a' : C.machine;
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, w * s - 4, h * s - 4, s * 0.15);
      ctx.fill();
      ctx.strokeStyle = isSorter ? '#d6c25f' : C.machineEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      const cx = x + (w * s) / 2, cy = y + (h * s) / 2;
      ctx.fillStyle = C.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (isSorter && p.filter) {
        this.itemDot(cx, cy, p.filter, s * 0.24);
        ctx.font = `${Math.max(8, s * 0.24)}px system-ui, sans-serif`;
        ctx.fillText('sort', cx, cy + s * 0.42);
      } else if (p.recipe && RECIPES[p.recipe]) {
        const r = RECIPES[p.recipe]!;
        this.itemDot(cx, cy - s * 0.15, r.output.item, Math.min(s * 0.3, (Math.min(w, h) * s) / 4));
        ctx.fillStyle = C.text;
        ctx.font = `${Math.max(8, s * 0.24)}px system-ui, sans-serif`;
        ctx.fillText(ITEMS[r.output.item]?.name ?? r.output.item, cx, cy + Math.min(s * 0.3, (h * s) / 4) + 2);
      } else {
        ctx.font = `${Math.max(8, s * 0.3)}px system-ui, sans-serif`;
        ctx.fillText(p.type, cx, cy);
      }
      ctx.textBaseline = 'alphabetic';
      for (const port of placementPorts(p)) this.drawPort(port.tile, port.side, port.kind);
    }

    if (o.tint) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = o.tint;
      for (const t of placementTiles(p)) ctx.fillRect(t.x * s, t.y * s, s, s);
    }
    ctx.restore();
  }

  private drawPort(tile: Vec, side: Dir, kind: PortDef['kind']): void {
    const ctx = this.ctx, s = this.cell;
    const v = DIR_VECS[side]!;
    const cx = (tile.x + 0.5 + v.x * 0.5) * s, cy = (tile.y + 0.5 + v.y * 0.5) * s;
    const color = PORT_COLOR[kind];
    // inputs point inward, outputs point outward
    const dir: Dir = kind === 'in' ? (((side + 2) % 4) as Dir) : side;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    this.arrow(cx - v.x * s * 0.05, cy - v.y * s * 0.05, dir, s * 0.17, color);
    ctx.restore();
  }

  private drawMachineState(
    p: Placement,
    progress: number,
    craft: number,
    stalled: boolean,
    deadlocked: boolean,
    timeMs: number,
  ): void {
    const ctx = this.ctx, s = this.cell;
    const { w, h } = footprint(p.type, p.rot);
    const x = p.pos.x * s + 5, y = (p.pos.y + h) * s - 9;
    const bw = w * s - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, bw, 5);
    ctx.fillStyle = stalled ? C.reject : progress > 0 ? C.in : '#556';
    ctx.fillRect(x, y, bw * (craft > 0 ? Math.min(1, progress / craft) : 0), 5);
    if (stalled) this.outline(p.pos, w, h, C.reject, 2);
    if (deadlocked) {
      // Pulsing amber outline plus a padlock badge; distinct from the red jam / stalled styles.
      const pulse = 0.5 + 0.5 * Math.sin(timeMs / 250);
      ctx.save();
      ctx.fillStyle = `rgba(255,176,32,${0.08 + 0.12 * pulse})`;
      ctx.fillRect(p.pos.x * s, p.pos.y * s, w * s, h * s);
      ctx.restore();
      this.outline(p.pos, w, h, C.deadlock, 2 + 2 * pulse, [7, 4]);
      const r = Math.max(7, s * 0.26);
      const bx = (p.pos.x + w) * s - r - 2, by = p.pos.y * s + r + 2;
      ctx.save();
      ctx.fillStyle = C.deadlock;
      ctx.strokeStyle = '#3a2600';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // padlock: shackle + body
      ctx.fillStyle = '#3a2600';
      ctx.lineWidth = Math.max(1.5, r * 0.18);
      ctx.beginPath();
      ctx.arc(bx, by - r * 0.15, r * 0.32, Math.PI, 0);
      ctx.stroke();
      ctx.fillRect(bx - r * 0.45, by - r * 0.15, r * 0.9, r * 0.6);
      ctx.restore();
    }
  }

  private drawItems(snap: SimSnapshot, alpha: number): void {
    const s = this.cell;
    const a = Math.max(0, Math.min(1, alpha));
    for (const it of snap.items) {
      const x = it.from.x + (it.pos.x - it.from.x) * a;
      const y = it.from.y + (it.pos.y - it.from.y) * a;
      this.itemDot((x + 0.5) * s, (y + 0.5) * s, it.item, s * 0.19);
    }
  }
}
