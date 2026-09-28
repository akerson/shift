// Pure editor logic: placement rules, belt painting, move/rotate/erase, undo stack.
// No DOM access here so everything is unit-testable.

import { PARTS } from '../shared/catalog';
import { footprint, placementTiles, vecKey } from '../shared/geometry';
import type { Dir, PartType, Placement, Puzzle, Rotation, Vec } from '../shared/types';
import { isBuildable } from '../shared/puzzle';

export type Placements = readonly Placement[];

export function isLogistics1x1(t: PartType): boolean {
  return t === 'belt' || t === 'merger' || t === 'splitter';
}

// ---------- undo / redo ----------

export interface History {
  past: Placements[];
  present: Placements;
  future: Placements[];
}

export function newHistory(present: Placements = []): History {
  return { past: [], present, future: [] };
}

export function samePlacements(a: Placements, b: Placements): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Push a new state; a no-op (same reference) when nothing changed. Clears redo. */
export function commit(h: History, next: Placements): History {
  if (samePlacements(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-200), present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  const past = h.past.slice();
  const prev = past.pop()!;
  return { past, present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  const [next, ...future] = h.future;
  return { past: [...h.past, h.present], present: next!, future };
}

// ---------- geometry / validity ----------

export function fixedTiles(puzzle: Puzzle): Set<string> {
  const s = new Set<string>();
  for (const t of puzzle.terrain) s.add(vecKey(t));
  for (const x of puzzle.sources) s.add(vecKey(x.pos));
  for (const x of puzzle.demands) s.add(vecKey(x.pos));
  for (const x of puzzle.disposals) s.add(vecKey(x.pos));
  return s;
}

/** tile key -> placement index. */
export function tileOwners(placements: Placements, skip?: ReadonlySet<number>): Map<string, number> {
  const m = new Map<string, number>();
  placements.forEach((p, i) => {
    if (skip?.has(i)) return;
    for (const t of placementTiles(p)) m.set(vecKey(t), i);
  });
  return m;
}

export function inBounds(puzzle: Puzzle, t: Vec): boolean {
  return t.x >= 0 && t.y >= 0 && t.x < puzzle.width && t.y < puzzle.height;
}

/**
 * Why a candidate cannot be placed, or null if it can. `ignore` are placement
 * indices treated as absent (used for moves and belt replacement).
 */
export function placementProblem(
  puzzle: Puzzle,
  placements: Placements,
  cand: Placement,
  ignore?: ReadonlySet<number>,
): string | null {
  if (!puzzle.parts.includes(cand.type)) return 'part not available';
  const fixed = fixedTiles(puzzle);
  const owners = tileOwners(placements, ignore);
  for (const t of placementTiles(cand)) {
    if (!inBounds(puzzle, t)) return 'out of bounds';
    if (!isBuildable(puzzle, t)) return 'edge is reserved for ports';
    const k = vecKey(t);
    if (fixed.has(k)) return 'blocked by terrain or fixed element';
    if (owners.has(k)) return 'overlaps another part';
  }
  return null;
}

/** Top-left position so the footprint is roughly centred on `tile`. */
export function anchorFor(type: PartType, rot: Rotation, tile: Vec): Vec {
  const { w, h } = footprint(type, rot);
  return { x: tile.x - Math.floor((w - 1) / 2), y: tile.y - Math.floor((h - 1) / 2) };
}

/** Build a candidate placement centred on a tile. */
export function makePlacement(
  type: PartType,
  rot: Rotation,
  tile: Vec,
  opts: { recipe?: string; filter?: string } = {},
): Placement {
  const p: Placement = { type, rot, pos: anchorFor(type, rot, tile) };
  if (opts.recipe) p.recipe = opts.recipe;
  if (opts.filter) p.filter = opts.filter;
  return p;
}

/**
 * Place a part. A 1x1 logistics part may replace an existing 1x1 logistics
 * part on the same tile. Returns null if invalid.
 */
export function placePart(puzzle: Puzzle, placements: Placements, cand: Placement): Placements | null {
  const ignore = new Set<number>();
  if (isLogistics1x1(cand.type)) {
    const owners = tileOwners(placements);
    const i = owners.get(vecKey(cand.pos));
    if (i !== undefined && isLogistics1x1(placements[i]!.type)) ignore.add(i);
  }
  if (placementProblem(puzzle, placements, cand, ignore)) return null;
  return [...placements.filter((_, i) => !ignore.has(i)), cand];
}

// ---------- belt drag ----------

export function dirBetween(a: Vec, b: Vec): Dir | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === 0) return 1;
  if (dx === 0 && dy === 1) return 2;
  if (dx === -1 && dy === 0) return 3;
  return null;
}

/**
 * Extend a drag path with a new pointer tile. Non-adjacent jumps are filled
 * with an L-shaped walk (horizontal first). Revisiting a tile already in the
 * path truncates the path back to it (so dragging backwards un-paints).
 */
export function extendPath(path: readonly Vec[], tile: Vec): Vec[] {
  if (!path.length) return [tile];
  const last = path[path.length - 1]!;
  if (last.x === tile.x && last.y === tile.y) return path.slice();
  const out = path.slice();
  let { x, y } = last;
  while (x !== tile.x || y !== tile.y) {
    if (x !== tile.x) x += Math.sign(tile.x - x);
    else y += Math.sign(tile.y - y);
    const idx = out.findIndex((p) => p.x === x && p.y === y);
    if (idx >= 0) out.length = idx + 1;
    else out.push({ x, y });
  }
  return out;
}

/** Belts for a drag path: each faces the next tile; the last keeps the drag direction. */
export function pathToBelts(path: readonly Vec[], fallback: Dir = 1): Placement[] {
  return path.map((pos, i) => {
    let rot: Dir = fallback;
    if (i < path.length - 1) rot = dirBetween(pos, path[i + 1]!) ?? fallback;
    else if (i > 0) rot = dirBetween(path[i - 1]!, pos) ?? fallback;
    return { type: 'belt', pos: { x: pos.x, y: pos.y }, rot };
  });
}

/** Apply painted belts on top of placements; tiles that cannot take a belt are skipped. */
export function paintBelts(puzzle: Puzzle, placements: Placements, belts: readonly Placement[]): Placements {
  let cur = placements;
  for (const b of belts) {
    const next = placePart(puzzle, cur, b);
    if (next) cur = next;
  }
  return cur;
}

// ---------- erase / select / move / rotate ----------

export function placementAt(placements: Placements, tile: Vec): number {
  const k = vecKey(tile);
  return placements.findIndex((p) => placementTiles(p).some((t) => vecKey(t) === k));
}

export function eraseAt(placements: Placements, tile: Vec): Placements {
  const i = placementAt(placements, tile);
  return i < 0 ? placements : placements.filter((_, j) => j !== i);
}

export function eraseIndices(placements: Placements, idx: readonly number[]): Placements {
  const s = new Set(idx);
  return placements.filter((_, i) => !s.has(i));
}

/** Indices of placements with any tile inside the inclusive box spanned by a and b. */
export function indicesInBox(placements: Placements, a: Vec, b: Vec): number[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const out: number[] = [];
  placements.forEach((p, i) => {
    if (placementTiles(p).some((t) => t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1)) out.push(i);
  });
  return out;
}

/** Move the selected placements by (dx,dy). Returns null if any would be invalid. */
export function movePlacements(
  puzzle: Puzzle,
  placements: Placements,
  sel: readonly number[],
  dx: number,
  dy: number,
): Placements | null {
  const s = new Set(sel);
  const moved = placements.map((p, i) => (s.has(i) ? { ...p, pos: { x: p.pos.x + dx, y: p.pos.y + dy } } : p));
  const fixed = fixedTiles(puzzle);
  const seen = new Set<string>();
  for (const p of moved) {
    for (const t of placementTiles(p)) {
      const k = vecKey(t);
      if (!inBounds(puzzle, t) || fixed.has(k) || seen.has(k)) return null;
      seen.add(k);
    }
  }
  return moved;
}

/** Rotate one placement in place (keeping its centre roughly). Null if the result is invalid. */
export function rotatePlacement(puzzle: Puzzle, placements: Placements, idx: number): Placements | null {
  const p = placements[idx];
  if (!p) return null;
  const rot = ((p.rot + 1) % 4) as Rotation;
  const a = footprint(p.type, p.rot), b = footprint(p.type, rot);
  const positions: Vec[] = [
    { x: p.pos.x + Math.trunc((a.w - b.w) / 2), y: p.pos.y + Math.trunc((a.h - b.h) / 2) },
    p.pos,
  ];
  for (const pos of positions) {
    const c: Placement = { ...p, rot, pos };
    if (!placementProblem(puzzle, placements, c, new Set([idx]))) {
      return placements.map((q, i) => (i === idx ? c : q));
    }
  }
  return null;
}

export function setPlacementField(
  placements: Placements,
  idx: number,
  patch: { recipe?: string; filter?: string },
): Placements {
  return placements.map((p, i) => (i === idx ? { ...p, ...patch } : p));
}

/** Recipes from the puzzle that a machine type can run. */
export function recipesFor(puzzle: Puzzle, type: PartType, all: Record<string, { machine: string }>): string[] {
  return puzzle.recipes.filter((r) => all[r]?.machine === type);
}

export function partLabel(t: PartType): string {
  return t[0]!.toUpperCase() + t.slice(1);
}

// ---------- persistence helpers (pure part) ----------

export function isPlacementArray(x: unknown): x is Placement[] {
  return (
    Array.isArray(x) &&
    x.every(
      (p) =>
        p &&
        typeof p.type === 'string' &&
        p.type in PARTS &&
        typeof p.pos?.x === 'number' &&
        typeof p.pos?.y === 'number' &&
        [0, 1, 2, 3].includes(p.rot),
    )
  );
}
