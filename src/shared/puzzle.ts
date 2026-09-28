import { ITEMS, PARTS, RECIPES } from './catalog';
import type { Dir, Puzzle, Rate, Vec } from './types';

/**
 * Players may only build on interior tiles; the outer ring of the floor is
 * reserved for sources, demand ports and disposal ports.
 */
export function isBuildable(p: Pick<Puzzle, 'width' | 'height'>, v: Vec): boolean {
  return v.x >= 1 && v.y >= 1 && v.x < p.width - 1 && v.y < p.height - 1;
}

/** Direction pointing from an edge tile into the floor, or null for corners and interior tiles. */
export function inwardDir(p: Pick<Puzzle, 'width' | 'height'>, v: Vec): Dir | null {
  const onW = v.x === 0, onE = v.x === p.width - 1, onN = v.y === 0, onS = v.y === p.height - 1;
  if ((onW || onE) && (onN || onS)) return null;
  if (onW) return 1;
  if (onE) return 3;
  if (onN) return 2;
  if (onS) return 0;
  return null;
}

/** Structural checks on a puzzle file. Returns a list of problems (empty = OK). */
export function validatePuzzle(p: Puzzle): string[] {
  const errs: string[] = [];
  if (p.format !== 1) errs.push(`unknown format ${String(p.format)}`);
  if (!(p.width > 0 && p.height > 0)) errs.push('bad dimensions');

  const inBounds = (v: Vec) => v.x >= 0 && v.y >= 0 && v.x < p.width && v.y < p.height;
  const seen = new Set<string>();
  const claim = (v: Vec, what: string) => {
    if (!inBounds(v)) errs.push(`${what} out of bounds at ${v.x},${v.y}`);
    const k = `${v.x},${v.y}`;
    if (seen.has(k)) errs.push(`${what} overlaps another fixed element at ${k}`);
    seen.add(k);
  };

  const onEdge = (v: Vec, dir: Dir, what: string) => {
    const want = inwardDir(p, v);
    if (want === null) errs.push(`${what} must be on the floor edge (not a corner)`);
    else if (dir !== want) errs.push(`${what} must face into the floor (dir ${want})`);
  };

  p.terrain.forEach((t) => claim(t, 'terrain'));
  p.sources.forEach((s, i) => {
    claim(s.pos, `source ${i}`);
    onEdge(s.pos, s.dir, `source ${i}`);
    if (!ITEMS[s.item]) errs.push(`source ${i}: unknown item ${s.item}`);
    if (!(s.rate.count > 0 && s.rate.ticks > 0)) errs.push(`source ${i}: bad rate`);
  });
  p.demands.forEach((d, i) => {
    claim(d.pos, `demand ${i}`);
    onEdge(d.pos, d.dir, `demand ${i}`);
    if (!ITEMS[d.item]) errs.push(`demand ${i}: unknown item ${d.item}`);
    if (!(d.rate.count > 0 && d.rate.ticks > 0)) errs.push(`demand ${i}: bad rate`);
  });
  p.disposals.forEach((d, i) => {
    claim(d.pos, `disposal ${i}`);
    onEdge(d.pos, d.dir, `disposal ${i}`);
  });
  p.recipes.forEach((r) => {
    if (!RECIPES[r]) errs.push(`unknown recipe ${r}`);
  });
  p.parts.forEach((t) => {
    if (!PARTS[t]) errs.push(`unknown part ${t}`);
  });
  if (p.windowTicks <= 0) errs.push('windowTicks must be positive');
  if (p.warmupTicks < 0) errs.push('warmupTicks must be non-negative');
  return errs;
}

export function parsePuzzle(json: unknown): Puzzle {
  const p = json as Puzzle;
  const errs = validatePuzzle(p);
  if (errs.length) throw new Error(`invalid puzzle: ${errs.join('; ')}`);
  return p;
}

/**
 * Items a demand port must receive during the measurement window to pass.
 * Floored: a steady line delivers floor or ceil of the exact amount depending on phase.
 */
export function requiredDeliveries(rate: Rate, windowTicks: number): number {
  return Math.floor((rate.count * windowTicks) / rate.ticks);
}
