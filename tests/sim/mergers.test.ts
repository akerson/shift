import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim';
import { belt, disposal, line, makePuzzle, merger, source, trace } from './helpers';

describe('merger', () => {
  it('alternates fairly between 2 saturated inputs', () => {
    const puzzle = makePuzzle({
      sources: [source(5, 3, 2, 'iron_ore'), source(5, 7, 0, 'copper_ore')],
      disposals: [disposal(8, 5, 3)],
    });
    const placements = [belt(5, 4, 2), belt(5, 6, 0), merger(5, 5, 1), ...line(6, 5, 7, 5, 1)];
    const sim = createSim(puzzle, placements);
    sim.run(10);
    const seq = trace(sim, 6, 5, 40);
    expect(seq.every((x) => x !== null)).toBe(true); // full output rate
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('shares 3 saturated inputs evenly, round-robin', () => {
    const puzzle = makePuzzle({
      sources: [source(5, 3, 2, 'iron_ore'), source(5, 7, 0, 'copper_ore'), source(3, 5, 1, 'stone')],
      disposals: [disposal(8, 5, 3)],
    });
    const placements = [belt(5, 4, 2), belt(5, 6, 0), belt(4, 5, 1), merger(5, 5, 1), ...line(6, 5, 7, 5, 1)];
    const sim = createSim(puzzle, placements);
    sim.run(10);
    const seq = trace(sim, 6, 5, 60);
    expect(seq.every((x) => x !== null)).toBe(true);
    for (let i = 0; i + 2 < seq.length; i++) {
      expect(new Set(seq.slice(i, i + 3)).size).toBe(3); // any 3 consecutive items are all different
    }
    const counts = new Map<string, number>();
    for (const s of seq) counts.set(s!, (counts.get(s!) ?? 0) + 1);
    expect([...counts.values()]).toEqual([20, 20, 20]);
  });

  it('passes a lone input at full rate', () => {
    const puzzle = makePuzzle({ sources: [source(3, 5, 1, 'iron_ore')], disposals: [disposal(8, 5, 3)] });
    const placements = [belt(4, 5, 1), merger(5, 5, 1), ...line(6, 5, 7, 5, 1)];
    const sim = createSim(puzzle, placements);
    sim.run(10);
    expect(trace(sim, 6, 5, 20).every((x) => x === 'iron_ore')).toBe(true);
  });

  it('does not accept from its front', () => {
    // belt at (6,5) facing west points into the merger front (merger faces east)
    const puzzle = makePuzzle({ sources: [source(7, 5, 3, 'iron_ore')] });
    const sim = createSim(puzzle, [merger(5, 5, 1), belt(6, 5, 3)]);
    sim.run(5);
    expect(sim.snapshot().jams[0]).toMatchObject({ pos: { x: 6, y: 5 }, reason: 'rejected' });
  });

  it('a merger output into empty floor is a dead-end jam', () => {
    const puzzle = makePuzzle({ sources: [source(3, 5, 1, 'iron_ore')] });
    const sim = createSim(puzzle, [belt(4, 5, 1), merger(5, 5, 1)]);
    sim.run(10);
    expect(sim.snapshot().jams).toHaveLength(1);
    expect(sim.snapshot().jams[0]).toMatchObject({ pos: { x: 5, y: 5 }, reason: 'dead-end' });
  });
});
