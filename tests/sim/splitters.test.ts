import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim';
import { belt, disposal, itemAt, line, machine, makePuzzle, source, splitter } from './helpers';

// Splitter at (5,5) facing east. Outputs: front (6,5), right/south (5,6), left/north (5,4).
function whereItLands(sim: ReturnType<typeof createSim>, ticks: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    const hits: string[] = [];
    if (itemAt(sim, 6, 5)) hits.push('front');
    if (itemAt(sim, 5, 6)) hits.push('right');
    if (itemAt(sim, 5, 4)) hits.push('left');
    out.push(hits.join('+'));
  }
  return out;
}

describe('splitter', () => {
  it('alternates between 3 outputs', () => {
    const puzzle = makePuzzle({
      sources: [source(3, 5, 1, 'iron_ore')],
      disposals: [disposal(7, 5, 3), disposal(5, 7, 0), disposal(5, 3, 2)],
    });
    const placements = [belt(4, 5, 1), splitter(5, 5, 1), belt(6, 5, 1), belt(5, 6, 2), belt(5, 4, 0)];
    const sim = createSim(puzzle, placements);
    sim.run(5);
    const seq = whereItLands(sim, 30);
    expect(seq.every((s) => s !== '' && !s.includes('+'))).toBe(true);
    for (let i = 0; i + 2 < seq.length; i++) expect(new Set(seq.slice(i, i + 3)).size).toBe(3);
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('alternates between 2 outputs and ignores a non-accepting side', () => {
    const puzzle = makePuzzle({
      sources: [source(3, 5, 1, 'iron_ore')],
      disposals: [disposal(7, 5, 3), disposal(5, 7, 0)],
    });
    // left side (5,4) is empty floor: never chosen, never a jam
    const placements = [belt(4, 5, 1), splitter(5, 5, 1), belt(6, 5, 1), belt(5, 6, 2)];
    const sim = createSim(puzzle, placements);
    sim.run(5);
    const seq = whereItLands(sim, 20);
    for (let i = 1; i < seq.length; i++) {
      expect(['front', 'right']).toContain(seq[i]);
      expect(seq[i]).not.toBe(seq[i - 1]);
    }
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('skips a blocked output and keeps the rest flowing at full rate', () => {
    const puzzle = makePuzzle({
      sources: [source(3, 5, 1, 'iron_ore')],
      disposals: [disposal(5, 8, 0)],
    });
    // front leg ends in a smelter whose output goes nowhere: it fills and blocks.
    const placements = [
      belt(4, 5, 1),
      splitter(5, 5, 1),
      belt(6, 5, 1),
      machine('smelter', 7, 5, 0, 'smelt_iron'),
      ...line(5, 6, 5, 7, 2),
    ];
    const sim = createSim(puzzle, placements);
    sim.run(100);
    for (let i = 0; i < 20; i++) {
      sim.step();
      expect(itemAt(sim, 5, 6)).toBe('iron_ore'); // free leg carries an item every tick
      expect(itemAt(sim, 6, 5)).toBe('iron_ore'); // blocked leg stays full
    }
    expect(sim.snapshot().jams).toHaveLength(0); // backpressure, not a jam
  });

  it('only accepts from its back', () => {
    const puzzle = makePuzzle({ sources: [source(5, 3, 2, 'iron_ore')] });
    const sim = createSim(puzzle, [belt(5, 4, 2), splitter(5, 5, 1)]);
    sim.run(5);
    expect(sim.snapshot().jams[0]).toMatchObject({ pos: { x: 5, y: 4 }, reason: 'rejected' });
  });

  it('a splitter with no usable output waits without jamming', () => {
    const puzzle = makePuzzle({ sources: [source(3, 5, 1, 'iron_ore')] });
    const sim = createSim(puzzle, [belt(4, 5, 1), splitter(5, 5, 1)]);
    sim.run(20);
    expect(sim.snapshot().jams).toHaveLength(0);
    expect(itemAt(sim, 5, 5)).toBe('iron_ore');
  });
});
