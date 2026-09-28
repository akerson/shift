import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim';
import { belt, demand, disposal, line, machine, makePuzzle, merger, sorter, source, splitter } from './helpers';

function factory() {
  const puzzle = makePuzzle({
    sources: [source(0, 5, 1, 'iron_ore', 1, 2), source(0, 7, 1, 'copper_ore', 2, 5)],
    demands: [demand(19, 5, 3, 'iron_plate', 1, 6), demand(19, 7, 3, 'copper_plate', 1, 6)],
    disposals: [disposal(19, 9, 3)],
  });
  const placements = [
    belt(1, 5, 1),
    belt(2, 5, 1),
    belt(1, 7, 1),
    belt(2, 7, 1),
    belt(3, 7, 0),
    belt(3, 6, 0),
    merger(3, 5, 1),
    sorter(4, 5, 0, 'iron_ore'),
    // forward lane: iron ore -> smelter
    belt(5, 5, 1),
    machine('smelter', 6, 5, 0, 'smelt_iron'),
    ...line(8, 5, 18, 5, 1),
    // side lane: copper ore -> splitter -> copper smelter / disposal
    belt(5, 6, 2),
    belt(5, 7, 1),
    splitter(6, 7, 1),
    machine('smelter', 7, 7, 0, 'smelt_copper'),
    ...line(9, 7, 18, 7, 1),
    belt(6, 8, 2),
    ...line(6, 9, 18, 9, 1),
  ];
  return { puzzle, placements };
}

describe('determinism', () => {
  it('identical inputs give identical snapshots over 500 ticks', () => {
    const { puzzle, placements } = factory();
    const a = createSim(puzzle, placements);
    const b = createSim(puzzle, JSON.parse(JSON.stringify(placements)));
    for (let t = 0; t < 500; t++) {
      a.step();
      b.step();
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
    const snap = a.snapshot();
    expect(snap.demands.every((d) => d.delivered > 20)).toBe(true); // the factory really runs
    expect(snap.jams).toEqual([]);
    // and run(n) equals n steps
    const c = createSim(puzzle, placements);
    c.run(500);
    expect(JSON.stringify(c.snapshot())).toBe(JSON.stringify(a.snapshot()));
  });

  it('snapshots are detached copies', () => {
    const { puzzle, placements } = factory();
    const s = createSim(puzzle, placements);
    s.run(30);
    const snap = s.snapshot();
    const before = JSON.stringify(snap);
    s.run(30);
    expect(JSON.stringify(snap)).toBe(before);
  });
});
