// Production planner: turns "I want item X at rate R" into a tree of recipes
// and machine counts, all in exact integer fractions. Pure and DOM-free so the
// game UI and the puzzle generator can share it.

import { ITEMS, RECIPES } from './catalog';
import type { ItemId, MachineType, Puzzle, Rate, Recipe, RecipeId } from './types';

// ---------- exact fractions ----------

/** A reduced fraction with a positive denominator. */
export interface Frac {
  n: number;
  d: number;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function frac(n: number, d = 1): Frac {
  if (d === 0) throw new Error('zero denominator');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

export const ZERO: Frac = { n: 0, d: 1 };

export function fAdd(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function fMul(a: Frac, b: Frac): Frac {
  return frac(a.n * b.n, a.d * b.d);
}
export function fDiv(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d, a.d * b.n);
}
/** Negative, zero or positive as a < b, a == b, a > b. */
export function fCmp(a: Frac, b: Frac): number {
  return a.n * b.d - b.n * a.d;
}
/** Smallest integer >= a (a must be non-negative). */
export function fCeil(a: Frac): number {
  const q = Math.floor(a.n / a.d);
  return a.n % a.d === 0 ? q : q + 1;
}
export function rateToFrac(r: Rate): Frac {
  return frac(r.count, r.ticks);
}

/** Decimal string with at most `digits` places (integer arithmetic, rounded half up, trailing zeros trimmed). */
export function fracDecimal(f: Frac, digits = 2): string {
  const scale = 10 ** digits;
  const scaled = Math.floor((f.n * scale * 2 + f.d) / (f.d * 2)); // round(n * scale / d)
  const whole = Math.floor(scaled / scale);
  const part = scaled % scale;
  if (part === 0) return String(whole);
  return `${whole}.${String(part).padStart(digits, '0').replace(/0+$/, '')}`;
}

/** Items-per-tick fraction in human form: "1 per 16 ticks", "3 per 8 ticks", "2 per tick". */
export function formatRate(f: Frac): string {
  if (f.n === 0) return '0';
  return f.d === 1 ? `${f.n} per tick` : `${f.n} per ${f.d} ticks`;
}

// ---------- plan tree ----------

export interface PlanInput {
  item: ItemId;
  count: number;
}

export interface PlanNode {
  item: ItemId;
  /** Required item flow (items per tick) through this node. */
  rate: Frac;
  /**
   * True when the item is taken from a source instead of crafted: raw items,
   * and items with no allowed recipe (`unavailable` is then also set).
   */
  raw: boolean;
  unavailable: boolean;
  recipe: RecipeId | null;
  machine: MachineType | null;
  craftTicks: number;
  /** Per-craft input counts. */
  inputs: PlanInput[];
  /** Per-craft output count of `item`. */
  outputCount: number;
  /** Exact machines needed (0 for raw). */
  machines: Frac;
  machinesCeil: number;
  /** Refinery only: byproduct per craft and its flow at this node's rate. */
  byproduct?: { item: ItemId; count: number; rate: Frac };
  children: PlanNode[];
}

/** First allowed recipe whose main output is `item`. */
export function recipeFor(item: ItemId, allowed: readonly RecipeId[]): Recipe | null {
  for (const id of allowed) {
    const r = RECIPES[id];
    if (r && r.output.item === item) return r;
  }
  return null;
}

export function planItem(item: ItemId, rate: Rate | Frac, allowed: readonly RecipeId[]): PlanNode {
  const f = 'ticks' in rate ? rateToFrac(rate) : frac(rate.n, rate.d);
  return build(item, f, allowed, new Set());
}

function build(item: ItemId, rate: Frac, allowed: readonly RecipeId[], path: Set<ItemId>): PlanNode {
  const isRaw = ITEMS[item]?.raw === true;
  const recipe = isRaw || path.has(item) ? null : recipeFor(item, allowed);
  if (!recipe) {
    return {
      item, rate, raw: true, unavailable: !isRaw, recipe: null, machine: null,
      craftTicks: 0, inputs: [], outputCount: 0, machines: ZERO, machinesCeil: 0, children: [],
    };
  }
  const craftsPerTick = fDiv(rate, frac(recipe.output.count));
  const machines = fMul(craftsPerTick, frac(recipe.craftTicks));
  const inputs = Object.entries(recipe.inputs).map(([i, count]) => ({ item: i, count }));
  const next = new Set(path).add(item);
  const node: PlanNode = {
    item, rate, raw: false, unavailable: false, recipe: recipe.id, machine: recipe.machine,
    craftTicks: recipe.craftTicks, inputs, outputCount: recipe.output.count,
    machines, machinesCeil: fCeil(machines),
    children: inputs.map((inp) => build(inp.item, fMul(craftsPerTick, frac(inp.count)), allowed, next)),
  };
  if (recipe.byproduct) {
    node.byproduct = {
      item: recipe.byproduct.item,
      count: recipe.byproduct.count,
      rate: fMul(craftsPerTick, frac(recipe.byproduct.count)),
    };
  }
  return node;
}

// ---------- puzzle-wide aggregation ----------

export interface RecipeTotal {
  recipe: RecipeId;
  machine: MachineType;
  /** Exact machines summed across every demand. */
  machines: Frac;
  /** ceil of the summed machines (machines can be shared between demands). */
  machinesCeil: number;
  /** Sum of each node's own ceil (machines needed if nothing is shared). */
  machinesCeilUnshared: number;
}

export interface RawTotal {
  item: ItemId;
  needed: Frac;
  /** Total rate of sources of this item on the floor (0 if none). */
  supplied: Frac;
  ok: boolean;
}

export interface ByproductTotal {
  item: ItemId;
  rate: Frac;
}

export interface PuzzlePlan {
  trees: { demandIndex: number; item: ItemId; rate: Frac; root: PlanNode }[];
  recipes: RecipeTotal[];
  raw: RawTotal[];
  byproducts: ByproductTotal[];
}

/** Plan every demand of a puzzle and aggregate totals. `allowed` defaults to the puzzle's recipes. */
export function planPuzzle(puzzle: Puzzle, allowed: readonly RecipeId[] = puzzle.recipes): PuzzlePlan {
  const trees = puzzle.demands.map((d, demandIndex) => {
    const rate = rateToFrac(d.rate);
    return { demandIndex, item: d.item, rate, root: planItem(d.item, rate, allowed) };
  });

  const rec = new Map<RecipeId, RecipeTotal>();
  const raw = new Map<ItemId, Frac>();
  const by = new Map<ItemId, Frac>();
  const walk = (n: PlanNode) => {
    if (n.raw) {
      raw.set(n.item, fAdd(raw.get(n.item) ?? ZERO, n.rate));
      return;
    }
    const t = rec.get(n.recipe!) ?? {
      recipe: n.recipe!, machine: n.machine!, machines: ZERO, machinesCeil: 0, machinesCeilUnshared: 0,
    };
    t.machines = fAdd(t.machines, n.machines);
    t.machinesCeil = fCeil(t.machines);
    t.machinesCeilUnshared += n.machinesCeil;
    rec.set(n.recipe!, t);
    if (n.byproduct) by.set(n.byproduct.item, fAdd(by.get(n.byproduct.item) ?? ZERO, n.byproduct.rate));
    n.children.forEach(walk);
  };
  trees.forEach((t) => walk(t.root));

  const supply = new Map<ItemId, Frac>();
  for (const s of puzzle.sources) supply.set(s.item, fAdd(supply.get(s.item) ?? ZERO, rateToFrac(s.rate)));

  return {
    trees,
    recipes: [...rec.values()],
    raw: [...raw.entries()].map(([item, needed]) => {
      const supplied = supply.get(item) ?? ZERO;
      return { item, needed, supplied, ok: fCmp(supplied, needed) >= 0 };
    }),
    byproducts: [...by.entries()].map(([item, rate]) => ({ item, rate })),
  };
}
