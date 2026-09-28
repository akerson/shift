// Mutable editor session: wraps the pure functions in state.ts with the
// current tool, selection, drag gesture, undo history and persistence.

import { ITEMS, RECIPES, isMachine } from '../shared/catalog';
import type { ItemId, PartType, Placement, Puzzle, Rotation, Vec } from '../shared/types';
import type { LayoutError, Sim, SimSnapshot } from '../sim/api';
import { engine } from './engine';
import type { GhostPart } from './render';
import {
  type History,
  type Placements,
  commit,
  eraseAt,
  eraseIndices,
  extendPath,
  indicesInBox,
  isPlacementArray,
  makePlacement,
  movePlacements,
  newHistory,
  paintBelts,
  pathToBelts,
  placePart,
  placementAt,
  recipesFor,
  redo,
  rotatePlacement,
  setPlacementField,
  undo,
} from './state';

export type Tool = { kind: 'select' } | { kind: 'erase' } | { kind: 'belt' } | { kind: 'part'; part: PartType };

export type Drag =
  | { kind: 'belt'; path: Vec[] }
  | { kind: 'box'; a: Vec; b: Vec }
  | { kind: 'move'; start: Vec; dx: number; dy: number; moved: Placements | null }
  | { kind: 'erase'; last: Vec };

const storageKey = (id: string) => `shift:build:${id}`;

export function loadBuild(id: string): Placement[] | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return isPlacementArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function saveBuild(id: string, placements: Placements): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(placements));
  } catch {
    /* storage unavailable: ignore */
  }
}

export class Session {
  history: History;
  tool: Tool = { kind: 'select' };
  rot: Rotation = 1;
  selected: number[] = [];
  hover: Vec | null = null;
  drag: Drag | null = null;
  errors: LayoutError[] = [];
  /** Default recipe per machine type for newly placed machines. */
  defaultRecipe: Record<string, string> = {};
  defaultFilter: ItemId;

  // simulation state
  sim: Sim | null = null;
  snapshot: SimSnapshot | null = null;
  running = false;
  tps = 12;
  lastTickTime = 0;
  tickAcc = 0;

  /** Placement briefly flashed on the floor (clicking a deadlock line), with its expiry time in ms. */
  flash: { placement: number; until: number } | null = null;

  private listeners = new Set<() => void>();

  constructor(readonly puzzle: Puzzle, initial: Placements = []) {
    this.history = newHistory(initial);
    for (const t of ['smelter', 'press', 'assembler', 'refinery'] as const) {
      const r = recipesFor(puzzle, t, RECIPES)[0];
      if (r) this.defaultRecipe[t] = r;
    }
    const items = Object.keys(ITEMS);
    this.defaultFilter =
      puzzle.demands[0]?.item ?? puzzle.sources[0]?.item ?? items[0] ?? 'iron_ore';
    this.revalidate();
  }

  get placements(): Placements {
    return this.history.present;
  }

  /** Editing is locked whenever a simulation exists (running or paused). */
  get locked(): boolean {
    return this.sim !== null;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    this.listeners.forEach((f) => f());
  }

  private revalidate(): void {
    this.errors = engine.validateLayout(this.puzzle, this.placements);
  }

  /** Commit a new placement list (if changed), then persist and refresh. */
  apply(next: Placements | null): boolean {
    if (!next || this.locked) return false;
    const h = commit(this.history, next);
    if (h === this.history) return false;
    this.history = h;
    this.afterEdit();
    return true;
  }

  private afterEdit(): void {
    this.selected = this.selected.filter((i) => i < this.placements.length);
    this.revalidate();
    saveBuild(this.puzzle.id, this.placements);
    this.notify();
  }

  undo(): void {
    if (this.locked) return;
    this.history = undo(this.history);
    this.selected = [];
    this.afterEdit();
  }

  redo(): void {
    if (this.locked) return;
    this.history = redo(this.history);
    this.selected = [];
    this.afterEdit();
  }

  clearAll(): void {
    this.apply([]);
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.drag = null;
    if (t.kind === 'belt') this.rot = 1;
    if (t.kind === 'part') this.rot = t.part === 'merger' || t.part === 'splitter' ? 1 : 0;
    if (t.kind !== 'select') this.selected = [];
    this.notify();
  }

  rotateGhost(): void {
    this.rot = ((this.rot + 1) % 4) as Rotation;
    this.notify();
  }

  /** R: rotate the hovered/selected placement in select mode, else the ghost. */
  rotateContext(): void {
    if (this.tool.kind === 'belt' || this.tool.kind === 'part') return this.rotateGhost();
    if (this.locked) return;
    let idx = -1;
    if (this.hover) idx = placementAt(this.placements, this.hover);
    if (idx < 0 && this.selected.length === 1) idx = this.selected[0]!;
    if (idx >= 0) this.apply(rotatePlacement(this.puzzle, this.placements, idx));
  }

  deleteSelected(): void {
    if (this.selected.length) {
      this.apply(eraseIndices(this.placements, this.selected));
      this.selected = [];
      this.notify();
    }
  }

  /** The single selected machine/sorter placement, if any. */
  get selectedConfigurable(): { index: number; placement: Placement } | null {
    if (this.selected.length !== 1) return null;
    const p = this.placements[this.selected[0]!];
    if (p && (isMachine(p.type) || p.type === 'sorter')) return { index: this.selected[0]!, placement: p };
    return null;
  }

  setRecipe(machine: PartType, recipe: string): void {
    const sel = this.selectedConfigurable;
    if (sel && sel.placement.type === machine) this.apply(setPlacementField(this.placements, sel.index, { recipe }));
    this.defaultRecipe[machine] = recipe;
    this.notify();
  }

  setFilter(filter: ItemId): void {
    const sel = this.selectedConfigurable;
    if (sel && sel.placement.type === 'sorter') this.apply(setPlacementField(this.placements, sel.index, { filter }));
    this.defaultFilter = filter;
    this.notify();
  }

  // ---------- candidate building ----------

  private candidate(tile: Vec): Placement | null {
    const t = this.tool;
    if (t.kind === 'belt') return makePlacement('belt', this.rot, tile);
    if (t.kind === 'part') {
      const opts: { recipe?: string; filter?: string } = {};
      if (isMachine(t.part)) {
        const r = this.defaultRecipe[t.part];
        if (r) opts.recipe = r;
      }
      if (t.part === 'sorter') opts.filter = this.defaultFilter;
      return makePlacement(t.part, this.rot, tile, opts);
    }
    return null;
  }

  ghosts(): GhostPart[] {
    if (this.locked) return [];
    const d = this.drag;
    if (d?.kind === 'belt') {
      let cur: Placements = this.placements;
      return pathToBelts(d.path, this.rot).map((b) => {
        const next = placePart(this.puzzle, cur, b);
        if (next) cur = next;
        return { placement: b, valid: next !== null };
      });
    }
    if (d?.kind === 'move') {
      return this.selected.map((i) => {
        const p = this.placements[i]!;
        return {
          placement: { ...p, pos: { x: p.pos.x + d.dx, y: p.pos.y + d.dy } },
          valid: d.moved !== null,
        };
      });
    }
    if (!d && this.hover && (this.tool.kind === 'belt' || this.tool.kind === 'part')) {
      const c = this.candidate(this.hover);
      if (c) return [{ placement: c, valid: placePart(this.puzzle, this.placements, c) !== null }];
    }
    return [];
  }

  // ---------- pointer gestures (tile coordinates) ----------

  pointerDown(tile: Vec, button: number, shift: boolean): void {
    if (this.locked) return;
    if (button === 2 || this.tool.kind === 'erase') {
      this.apply(eraseAt(this.placements, tile));
      this.drag = { kind: 'erase', last: tile };
      return;
    }
    const t = this.tool;
    if (t.kind === 'belt') {
      this.drag = { kind: 'belt', path: [tile] };
    } else if (t.kind === 'part') {
      const c = this.candidate(tile);
      if (c) this.apply(placePart(this.puzzle, this.placements, c));
    } else {
      const idx = placementAt(this.placements, tile);
      if (idx >= 0) {
        if (!this.selected.includes(idx)) this.selected = shift ? [...this.selected, idx] : [idx];
        this.drag = { kind: 'move', start: tile, dx: 0, dy: 0, moved: this.placements };
      } else {
        if (!shift) this.selected = [];
        this.drag = { kind: 'box', a: tile, b: tile };
      }
      this.notify();
    }
  }

  pointerMove(tile: Vec): void {
    this.hover = tile;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'belt') d.path = extendPath(d.path, tile);
    else if (d.kind === 'box') d.b = tile;
    else if (d.kind === 'move') {
      d.dx = tile.x - d.start.x;
      d.dy = tile.y - d.start.y;
      d.moved = movePlacements(this.puzzle, this.placements, this.selected, d.dx, d.dy);
    } else if (d.kind === 'erase') {
      // erase along the dragged line
      for (const p of extendPath([d.last], tile)) this.apply(eraseAt(this.placements, p));
      d.last = tile;
    }
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'belt') {
      this.apply(paintBelts(this.puzzle, this.placements, pathToBelts(d.path, this.rot)));
    } else if (d.kind === 'box') {
      const inBox = indicesInBox(this.placements, d.a, d.b);
      const same = d.a.x === d.b.x && d.a.y === d.b.y;
      this.selected = same ? [] : [...new Set([...this.selected, ...inBox])];
      this.notify();
    } else if (d.kind === 'move') {
      if ((d.dx || d.dy) && d.moved) this.apply(d.moved);
    }
    this.notify();
  }

  cancelDrag(): void {
    this.drag = null;
  }

  // ---------- simulation control ----------

  /** Returns false (and leaves edit mode) if layout errors prevent running. */
  startSim(): boolean {
    this.revalidate();
    if (this.errors.length) {
      this.notify();
      return false;
    }
    try {
      this.sim = engine.createSim(this.puzzle, this.placements);
    } catch {
      this.sim = null;
      return false;
    }
    this.snapshot = this.sim.snapshot();
    this.selected = [];
    this.drag = null;
    this.tickAcc = 0;
    this.notify();
    return true;
  }

  stepOnce(now: number): void {
    if (!this.sim && !this.startSim()) return;
    this.running = false;
    this.advance(now);
    this.notify();
  }

  toggleRun(now: number): void {
    if (!this.sim && !this.startSim()) return;
    this.running = !this.running;
    this.lastTickTime = now;
    this.lastFrame = now;
    this.tickAcc = 0;
    this.notify();
  }

  /** Select a placement and flash it on the floor so the player can find it. */
  focusPlacement(index: number, now: number): void {
    if (!this.placements[index]) return;
    this.selected = [index];
    this.flash = { placement: index, until: now + 1600 };
    this.notify();
  }

  reset(): void {
    this.flash = null;
    this.sim = null;
    this.snapshot = null;
    this.running = false;
    this.notify();
  }

  private advance(now: number): void {
    if (!this.sim) return;
    this.sim.step();
    this.snapshot = this.sim.snapshot();
    this.lastTickTime = now;
  }

  /** Per-frame update; returns interpolation alpha for item rendering. */
  frame(now: number): number {
    if (!this.sim) return 1;
    const tickMs = 1000 / this.tps;
    if (this.running) {
      this.tickAcc += Math.min(250, now - (this.lastFrame || now));
      let n = 0;
      while (this.tickAcc >= tickMs && n < 20) {
        this.tickAcc -= tickMs;
        this.advance(now);
        n++;
      }
      if (n) this.notify();
      this.lastFrame = now;
      return Math.min(1, this.tickAcc / tickMs);
    }
    this.lastFrame = now;
    return Math.min(1, (now - this.lastTickTime) / 160);
  }
  private lastFrame = 0;
}
