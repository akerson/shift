import { PARTS, RECIPES, isMachine } from '../shared/catalog';
import { placementTiles } from '../shared/geometry';
import type { Placement, Puzzle } from '../shared/types';
import type { LayoutError } from './api';
import { buildTopology } from './topology';
import { isBuildable } from '../shared/puzzle';

export function scoreStatic(placements: readonly Placement[]): { footprint: number; cost: number } {
  let cost = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    cost += PARTS[p.type]?.cost ?? 0;
    for (const t of placementTiles(p)) {
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x > maxX) maxX = t.x;
      if (t.y > maxY) maxY = t.y;
    }
  }
  const footprint = placements.length === 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
  return { footprint, cost };
}

export function validateLayout(puzzle: Puzzle, placements: readonly Placement[]): LayoutError[] {
  const errors: LayoutError[] = [];
  const W = puzzle.width;
  const H = puzzle.height;
  const occupied = new Map<number, string>(); // tile -> 'fixed' | 'p<i>'
  const key = (x: number, y: number) => y * W + x;
  for (const t of puzzle.terrain) occupied.set(key(t.x, t.y), 'fixed');
  for (const s of puzzle.sources) occupied.set(key(s.pos.x, s.pos.y), 'fixed');
  for (const d of puzzle.demands) occupied.set(key(d.pos.x, d.pos.y), 'fixed');
  for (const d of puzzle.disposals) occupied.set(key(d.pos.x, d.pos.y), 'fixed');

  let structural = false;
  placements.forEach((p, i) => {
    const def = PARTS[p.type];
    if (!def) {
      errors.push({ code: 'part-not-allowed', placement: i, pos: p.pos, message: `Unknown part ${String(p.type)}` });
      structural = true;
      return;
    }
    if (!puzzle.parts.includes(p.type)) {
      errors.push({ code: 'part-not-allowed', placement: i, pos: p.pos, message: `${p.type} is not available on this floor` });
      structural = true;
    }
    if (isMachine(p.type)) {
      const r = p.recipe ? RECIPES[p.recipe] : undefined;
      if (!p.recipe || !r || r.machine !== p.type || !puzzle.recipes.includes(p.recipe)) {
        errors.push({ code: 'bad-recipe', placement: i, pos: p.pos, message: `${p.type} needs a valid recipe from this puzzle` });
        structural = true;
      }
    }
    if (p.type === 'sorter' && !p.filter) {
      errors.push({ code: 'missing-filter', placement: i, pos: p.pos, message: 'Sorter needs a filter item' });
      structural = true;
    }
    let oob = false;
    let edge = false;
    let overlap = false;
    for (const t of placementTiles(p)) {
      if (t.x < 0 || t.y < 0 || t.x >= W || t.y >= H) {
        oob = true;
        continue;
      }
      if (!isBuildable(puzzle, t)) edge = true;
      const k = key(t.x, t.y);
      if (occupied.has(k)) overlap = true;
      else occupied.set(k, `p${i}`);
    }
    if (oob) {
      errors.push({ code: 'out-of-bounds', placement: i, pos: p.pos, message: 'Part extends outside the floor' });
      structural = true;
    }
    if (edge && !oob) {
      errors.push({ code: 'edge', placement: i, pos: p.pos, message: 'The floor edge is reserved for ports' });
      structural = true;
    }
    if (overlap) {
      errors.push({ code: 'overlap', placement: i, pos: p.pos, message: 'Part overlaps another part or a fixed element' });
      structural = true;
    }
  });

  if (!structural) {
    const topo = buildTopology(puzzle, placements);
    const count = new Map<number, number>();
    const feed = (t: { k: string; idx?: number }) => {
      if (t.k === 'holder') count.set(t.idx!, (count.get(t.idx!) ?? 0) + 1);
    };
    for (const n of topo.nodes) for (const t of n.targets) feed(t);
    for (const s of topo.sources) feed(s.target);
    for (const h of topo.holders) {
      if (h.kind === 'belt' && (count.get(h.idx) ?? 0) > 1) {
        errors.push({
          code: 'multiple-feeders',
          placement: h.placement,
          pos: h.pos,
          message: 'More than one part feeds this belt; use a merger',
        });
      }
    }
  }
  return errors;
}
