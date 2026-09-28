import { describe, expect, it } from 'vitest';
import { createSim, scoreStatic, validateLayout } from '../../src/sim';
import type { Placement } from '../../src/shared/types';
import { belt, demand, disposal, line, machine, makePuzzle, merger, sorter, source, splitter } from './helpers';

const codes = (p: ReturnType<typeof makePuzzle>, pl: Placement[]) => validateLayout(p, pl).map((e) => e.code);

describe('validateLayout', () => {
  const base = () =>
    makePuzzle({
      terrain: [{ x: 10, y: 10 }],
      sources: [source(0, 5, 1, 'iron_ore')],
      demands: [demand(19, 5, 3, 'iron_plate')],
      disposals: [disposal(19, 6, 3)],
    });

  it('accepts a clean layout', () => {
    expect(validateLayout(base(), [...line(1, 5, 4, 5, 1), machine('smelter', 5, 5, 0, 'smelt_iron')])).toEqual([]);
    expect(validateLayout(base(), [])).toEqual([]);
  });

  it('out-of-bounds', () => {
    expect(codes(base(), [belt(-1, 3, 1)])).toEqual(['out-of-bounds']);
    expect(codes(base(), [belt(20, 3, 1)])).toEqual(['out-of-bounds']);
    // machine hanging off the edge
    const e = validateLayout(base(), [machine('smelter', 19, 19, 0, 'smelt_iron')]);
    expect(e.map((x) => x.code)).toContain('out-of-bounds');
    expect(e[0]!.placement).toBe(0);
  });

  it('overlap: placements, terrain, sources, demands, disposals', () => {
    expect(codes(base(), [belt(3, 3, 1), belt(3, 3, 0)])).toEqual(['overlap']);
    expect(codes(base(), [belt(10, 10, 1)])).toEqual(['overlap']);
    expect(codes(base(), [belt(0, 5, 1)])).toEqual(['edge', 'overlap']);
    expect(codes(base(), [belt(19, 5, 1)])).toEqual(['edge', 'overlap']);
    expect(codes(base(), [belt(19, 6, 1)])).toEqual(['edge', 'overlap']);
    // multi-tile machine covering terrain / another part
    expect(codes(base(), [machine('smelter', 9, 9, 0, 'smelt_iron')])).toEqual(['overlap']);
    expect(codes(base(), [belt(6, 6, 1), machine('smelter', 5, 5, 0, 'smelt_iron')])).toEqual(['overlap']);
    const e = validateLayout(base(), [belt(3, 3, 1), belt(3, 3, 0)]);
    expect(e[0]!.placement).toBe(1);
  });

  it('edge: the outer ring is reserved for ports', () => {
    expect(codes(base(), [belt(3, 0, 1)])).toEqual(['edge']);
    expect(codes(base(), [belt(3, 19, 1)])).toEqual(['edge']);
    expect(codes(base(), [machine('smelter', 18, 3, 0, 'smelt_iron')])).toEqual(['edge']);
    expect(codes(base(), [belt(1, 1, 1), belt(18, 18, 1)])).toEqual([]);
  });

  it('part-not-allowed', () => {
    const p = makePuzzle({ parts: ['belt'] });
    expect(codes(p, [merger(2, 2, 1)])).toEqual(['part-not-allowed']);
    expect(codes(p, [belt(2, 2, 1)])).toEqual([]);
  });

  it('bad-recipe', () => {
    const p = base();
    expect(codes(p, [{ type: 'smelter', pos: { x: 2, y: 2 }, rot: 0 }])).toEqual(['bad-recipe']); // missing
    expect(codes(p, [machine('smelter', 2, 2, 0, 'press_gear')])).toEqual(['bad-recipe']); // other machine's recipe
    expect(codes(p, [machine('smelter', 2, 2, 0, 'nonsense')])).toEqual(['bad-recipe']); // unknown
    const narrow = makePuzzle({ recipes: ['smelt_copper'] });
    expect(codes(narrow, [machine('smelter', 2, 2, 0, 'smelt_iron')])).toEqual(['bad-recipe']); // not in puzzle
    expect(codes(narrow, [machine('smelter', 2, 2, 0, 'smelt_copper')])).toEqual([]);
  });

  it('missing-filter', () => {
    expect(codes(base(), [{ type: 'sorter', pos: { x: 2, y: 2 }, rot: 0 }])).toEqual(['missing-filter']);
    expect(codes(base(), [sorter(2, 2, 0, 'iron_plate')])).toEqual([]);
  });

  it('multiple-feeders: two belts into one belt, but not into a merger', () => {
    // (5,5) faces east and is fed by (4,5) and (5,4) (from north) -> two feeders
    const bad = [belt(4, 5, 1), belt(5, 4, 2), belt(5, 5, 1)];
    const e = validateLayout(base(), bad);
    expect(e.map((x) => x.code)).toEqual(['multiple-feeders']);
    expect(e[0]!.placement).toBe(2);
    expect(codes(base(), [belt(4, 5, 1), belt(5, 4, 2), merger(5, 5, 1)])).toEqual([]);
  });

  it('multiple-feeders counts sources and splitter outputs; head-on belts are not feeders', () => {
    const p = makePuzzle({ sources: [source(5, 3, 2, 'iron_ore')] });
    // source above (5,4)... belt (5,4) faces east: fed by source from its side and by belt (4,4)
    expect(codes(p, [belt(4, 4, 1), belt(5, 4, 1)])).toEqual(['multiple-feeders']);
    // belt facing the front of another is rejected at runtime, not a layout error
    expect(codes(makePuzzle(), [belt(4, 5, 1), belt(5, 5, 3)])).toEqual([]);
    // a splitter's two outputs never feed the same belt
    expect(codes(makePuzzle(), [splitter(5, 5, 1), belt(6, 5, 1), belt(5, 6, 2)])).toEqual([]);
  });

  it('createSim throws on invalid layouts', () => {
    expect(() => createSim(base(), [belt(0, 5, 1)])).toThrow();
    expect(() => createSim(base(), [belt(1, 5, 1)])).not.toThrow();
  });
});

describe('scoreStatic', () => {
  it('empty build is 0/0', () => {
    expect(scoreStatic([])).toEqual({ footprint: 0, cost: 0 });
  });
  it('bounding box over all tiles, and summed part cost', () => {
    const pl = [belt(2, 3, 1), machine('smelter', 5, 4, 0, 'smelt_iron'), sorter(4, 8, 0, 'iron_plate')];
    // x: 2..6 (5), y: 3..9 (7) -> 35; cost 1 + 20 + 5
    expect(scoreStatic(pl)).toEqual({ footprint: 35, cost: 26 });
    expect(scoreStatic([belt(7, 7, 0)])).toEqual({ footprint: 1, cost: 1 });
    // rotated 1x2 sorter is 2x1
    expect(scoreStatic([sorter(3, 3, 1, 'x')]).footprint).toBe(2);
  });
});
