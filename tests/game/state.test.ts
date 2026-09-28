import { describe, expect, it } from 'vitest';
import type { Placement, Puzzle } from '../../src/shared/types';
import {
  commit,
  eraseAt,
  extendPath,
  indicesInBox,
  makePlacement,
  movePlacements,
  newHistory,
  paintBelts,
  pathToBelts,
  placePart,
  redo,
  rotatePlacement,
  undo,
} from '../../src/game/state';

const puzzle: Puzzle = {
  format: 1,
  id: 't',
  number: 0,
  width: 10,
  height: 10,
  terrain: [{ x: 5, y: 5 }],
  sources: [{ pos: { x: 0, y: 0 }, dir: 1, item: 'iron_ore', rate: { count: 1, ticks: 6 } }],
  demands: [],
  disposals: [],
  recipes: ['smelt_iron'],
  parts: ['belt', 'smelter'],
  warmupTicks: 10,
  windowTicks: 10,
};

const belt = (x: number, y: number, rot: 0 | 1 | 2 | 3 = 1): Placement => ({ type: 'belt', pos: { x, y }, rot });

describe('belt drag paths', () => {
  it('builds straight paths with the last tile keeping direction', () => {
    let path = extendPath([], { x: 1, y: 1 });
    path = extendPath(path, { x: 3, y: 1 });
    const belts = pathToBelts(path);
    expect(belts.map((b) => b.rot)).toEqual([1, 1, 1]);
    expect(belts.map((b) => b.pos.x)).toEqual([1, 2, 3]);
  });

  it('turns corners and keeps the final drag direction', () => {
    let path = extendPath([], { x: 1, y: 1 });
    path = extendPath(path, { x: 3, y: 1 });
    path = extendPath(path, { x: 3, y: 3 });
    const belts = pathToBelts(path);
    // east, east, (corner) south, south, last keeps south
    expect(belts.map((b) => b.rot)).toEqual([1, 1, 2, 2, 2]);
  });

  it('fills jumps with an L walk and un-paints when dragging backwards', () => {
    const path = extendPath([{ x: 0, y: 0 }], { x: 2, y: 2 });
    expect(path).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ]);
    expect(extendPath(path, { x: 2, y: 0 })).toEqual(path.slice(0, 3));
  });

  it('single tile uses the fallback rotation', () => {
    expect(pathToBelts([{ x: 4, y: 4 }], 3)[0]!.rot).toBe(3);
  });

  it('painting skips blocked tiles and replaces existing belts', () => {
    const start = [belt(2, 5, 0)];
    const path = extendPath([{ x: 4, y: 5 }], { x: 6, y: 5 });
    const out = paintBelts(puzzle, start, pathToBelts(path));
    expect(out.some((p) => p.pos.x === 5 && p.pos.y === 5)).toBe(false);
    expect(out).toHaveLength(3);
    const re = paintBelts(puzzle, [belt(1, 1, 0)], [belt(1, 1, 2)]);
    expect(re).toEqual([belt(1, 1, 2)]);
  });
});

describe('placement validity', () => {
  it('rejects terrain, fixed elements, out of bounds and overlap', () => {
    expect(placePart(puzzle, [], belt(5, 5))).toBeNull();
    expect(placePart(puzzle, [], belt(0, 0))).toBeNull();
    expect(placePart(puzzle, [], belt(-1, 3))).toBeNull();
    const sm = makePlacement('smelter', 0, { x: 9, y: 9 }, { recipe: 'smelt_iron' });
    expect(placePart(puzzle, [], sm)).toBeNull();
    const ok = makePlacement('smelter', 0, { x: 3, y: 3 }, { recipe: 'smelt_iron' });
    const placed = placePart(puzzle, [], ok)!;
    expect(placed).toHaveLength(1);
    expect(placePart(puzzle, placed, belt(ok.pos.x, ok.pos.y))).toBeNull();
  });

  it('rejects parts not in the puzzle', () => {
    expect(placePart(puzzle, [], makePlacement('sorter', 0, { x: 3, y: 3 }, { filter: 'iron_ore' }))).toBeNull();
  });
});

describe('undo / redo', () => {
  it('walks history and clears redo on new commits', () => {
    let h = newHistory();
    h = commit(h, [belt(1, 1)]);
    h = commit(h, [belt(1, 1), belt(2, 1)]);
    expect(h.present).toHaveLength(2);
    h = undo(h);
    expect(h.present).toHaveLength(1);
    h = redo(h);
    expect(h.present).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present).toHaveLength(0);
    expect(undo(h)).toBe(h);
    h = commit(h, [belt(9, 9)]);
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('ignores no-op commits', () => {
    const h = commit(newHistory(), [belt(1, 1)]);
    expect(commit(h, [belt(1, 1)])).toBe(h);
  });
});

describe('erase / select / move / rotate', () => {
  const two = [belt(1, 1), belt(2, 1)];

  it('erases the part covering a tile', () => {
    const sm = makePlacement('smelter', 0, { x: 3, y: 3 }, { recipe: 'smelt_iron' });
    expect(eraseAt([sm, belt(8, 8)], { x: sm.pos.x + 1, y: sm.pos.y + 1 })).toHaveLength(1);
  });

  it('box select finds intersecting placements', () => {
    expect(indicesInBox(two, { x: 2, y: 0 }, { x: 5, y: 3 })).toEqual([1]);
  });

  it('moves a selection and rejects overlaps, terrain and bounds', () => {
    const three = [belt(1, 1), belt(2, 1), belt(3, 1)];
    expect(movePlacements(puzzle, three, [0], 0, 2)![0]!.pos).toEqual({ x: 1, y: 3 });
    expect(movePlacements(puzzle, three, [0], 1, 0)).toBeNull(); // onto belt 1
    expect(movePlacements(puzzle, three, [0, 1, 2], 1, 0)).not.toBeNull(); // moves together
    expect(movePlacements(puzzle, [belt(4, 5)], [0], 1, 0)).toBeNull(); // terrain
    expect(movePlacements(puzzle, [belt(0, 4)], [0], -1, 0)).toBeNull(); // bounds
  });

  it('rotates in place unless blocked', () => {
    const out = rotatePlacement(puzzle, [belt(2, 2, 0)], 0)!;
    expect(out[0]!.rot).toBe(1);
    const sm = makePlacement('smelter', 0, { x: 2, y: 2 }, { recipe: 'smelt_iron' });
    expect(rotatePlacement(puzzle, [sm], 0)![0]!.rot).toBe(1);
  });
});
