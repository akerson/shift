import { describe, expect, it } from 'vitest';
import {
  fCeil, frac, fracDecimal, formatRate, planItem, planPuzzle, type PlanNode,
} from '../../src/shared/planner';
import type { Puzzle } from '../../src/shared/types';

// Self-contained fixture so tuning the real puzzle files never breaks these tests.
const chip: Puzzle = {
  format: 1, id: 'planner-chip', number: 0, width: 16, height: 16, terrain: [],
  sources: [
    { pos: { x: 0, y: 3 }, dir: 1, item: 'copper_ore', rate: { count: 1, ticks: 8 } },
    { pos: { x: 5, y: 0 }, dir: 2, item: 'crude', rate: { count: 1, ticks: 8 } },
    { pos: { x: 5, y: 15 }, dir: 0, item: 'iron_ore', rate: { count: 1, ticks: 16 } },
  ],
  demands: [{ pos: { x: 15, y: 8 }, dir: 3, item: 'chip', rate: { count: 1, ticks: 16 } }],
  disposals: [],
  recipes: ['smelt_iron', 'smelt_copper', 'press_wire', 'asm_circuit', 'refine_plastic', 'asm_chip'],
  parts: ['belt'],
  warmupTicks: 200, windowTicks: 200,
};

const find = (n: PlanNode, item: string): PlanNode | undefined =>
  n.item === item ? n : n.children.map((c) => find(c, item)).find(Boolean);

describe('fractions', () => {
  it('reduces and formats', () => {
    expect(frac(6, -4)).toEqual({ n: -3, d: 2 });
    expect(fCeil(frac(3, 2))).toBe(2);
    expect(fCeil(frac(4, 2))).toBe(2);
    expect(fracDecimal(frac(3, 2))).toBe('1.5');
    expect(fracDecimal(frac(1, 3))).toBe('0.33');
    expect(fracDecimal(frac(4, 1))).toBe('4');
    expect(formatRate(frac(2, 32))).toBe('1 per 16 ticks');
    expect(formatRate(frac(2, 1))).toBe('2 per tick');
  });
});

describe('planItem', () => {
  it('plans a single smelt', () => {
    const n = planItem('iron_plate', { count: 1, ticks: 3 }, ['smelt_iron']);
    expect(n.recipe).toBe('smelt_iron');
    expect(n.machines).toEqual({ n: 2, d: 1 });
    expect(n.children[0]!.raw).toBe(true);
    expect(n.children[0]!.rate).toEqual({ n: 1, d: 3 });
  });

  it('gives fractional machine counts with ceil', () => {
    const n = planItem('gear', { count: 3, ticks: 16 }, ['press_gear', 'smelt_iron']);
    // 3/16 gears/tick, 8 ticks each -> 3/2 presses
    expect(n.machines).toEqual({ n: 3, d: 2 });
    expect(n.machinesCeil).toBe(2);
    expect(n.inputs).toEqual([{ item: 'iron_plate', count: 2 }]);
    // 3/16 crafts * 2 plates = 3/8 plates/tick, 6 ticks each -> 9/4
    expect(n.children[0]!.machines).toEqual({ n: 9, d: 4 });
    expect(n.children[0]!.rate).toEqual({ n: 3, d: 8 });
  });

  it('respects output counts and reports refinery byproducts', () => {
    const wire = planItem('wire', { count: 1, ticks: 2 }, ['press_wire', 'smelt_copper']);
    expect(wire.machines).toEqual({ n: 1, d: 1 }); // 1/4 crafts/tick * 4 ticks
    const plastic = planItem('plastic', { count: 1, ticks: 16 }, ['refine_plastic']);
    expect(plastic.byproduct).toEqual({ item: 'gas', count: 1, rate: { n: 1, d: 16 } });
    expect(plastic.machines).toEqual({ n: 1, d: 2 });
    expect(plastic.children[0]!.rate).toEqual({ n: 1, d: 8 });
  });

  it('treats items without an allowed recipe as unavailable raw', () => {
    const n = planItem('gear', { count: 1, ticks: 8 }, []);
    expect(n.raw).toBe(true);
    expect(n.unavailable).toBe(true);
  });
});

describe('planPuzzle', () => {
  const plan = planPuzzle(chip);
  it('builds the chip tree', () => {
    const root = plan.trees[0]!.root;
    expect(root.recipe).toBe('asm_chip');
    expect(root.machines).toEqual({ n: 1, d: 1 });
    expect(find(root, 'circuit')!.machines).toEqual({ n: 3, d: 4 });
    expect(find(root, 'wire')!.machines).toEqual({ n: 3, d: 8 });
  });
  it('totals raw needs against supply', () => {
    const raw = Object.fromEntries(plan.raw.map((r) => [r.item, r]));
    expect(raw.iron_ore!.needed).toEqual({ n: 1, d: 16 });
    expect(raw.iron_ore!.supplied).toEqual({ n: 1, d: 16 });
    expect(raw.iron_ore!.ok).toBe(true);
    expect(raw.copper_ore!.needed).toEqual({ n: 3, d: 32 });
    expect(raw.crude!.needed).toEqual({ n: 1, d: 8 });
    expect(plan.raw.every((r) => r.ok)).toBe(true);
    expect(plan.byproducts).toEqual([{ item: 'gas', rate: { n: 1, d: 16 } }]);
  });
  it('flags insufficient supply', () => {
    const p = planPuzzle({ ...chip, sources: chip.sources.filter((s) => s.item !== 'crude') });
    expect(p.raw.find((r) => r.item === 'crude')!.ok).toBe(false);
  });
  it('aggregates machines per recipe', () => {
    const t = plan.recipes.find((r) => r.recipe === 'asm_circuit')!;
    expect(t.machines).toEqual({ n: 3, d: 4 });
    expect(t.machinesCeil).toBe(1);
  });
});
