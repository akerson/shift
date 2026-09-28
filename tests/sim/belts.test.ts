import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim';
import { belt, demand, itemAt, line, makePuzzle, source, trace } from './helpers';

describe('belts', () => {
  it('moves an item exactly one tile per tick and delivers it', () => {
    const puzzle = makePuzzle({
      sources: [source(0, 5, 1, 'iron_ore', 1, 6)],
      demands: [demand(9, 5, 3, 'iron_ore')],
    });
    const sim = createSim(puzzle, line(1, 5, 8, 5, 1));
    sim.run(5);
    expect(sim.snapshot().items).toHaveLength(0);
    sim.step(); // tick 6: first emission
    expect(itemAt(sim, 1, 5)).toBe('iron_ore');
    for (let k = 1; k <= 7; k++) {
      sim.step();
      expect(itemAt(sim, 1 + k, 5)).toBe('iron_ore');
      if (k < 6) expect(sim.snapshot().items).toHaveLength(1);
    }
    expect(sim.snapshot().demands[0]!.delivered).toBe(0);
    sim.step(); // tick 14: leaves the last belt into the demand
    const s = sim.snapshot();
    expect(s.demands[0]!.delivered).toBe(1);
    expect(s.firstDelivery).toBe(14);
    expect(s.items).toHaveLength(1);
    expect(s.jams).toHaveLength(0);
  });

  it('reports from/pos for rendering', () => {
    const puzzle = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore', 1, 6)], demands: [demand(9, 5, 3, 'iron_ore')] });
    const sim = createSim(puzzle, line(1, 5, 8, 5, 1));
    sim.run(7);
    const it = sim.snapshot().items[0]!;
    expect(it.from).toEqual({ x: 1, y: 5 });
    expect(it.pos).toEqual({ x: 2, y: 5 });
  });

  it('turns corners', () => {
    const puzzle = makePuzzle({
      sources: [source(0, 5, 1, 'iron_ore', 1, 6)],
      demands: [demand(3, 9, 0, 'iron_ore')],
    });
    const placements = [belt(1, 5, 1), belt(2, 5, 1), belt(3, 5, 2), belt(3, 6, 2), belt(3, 7, 2), belt(3, 8, 2)];
    const sim = createSim(puzzle, placements);
    sim.run(6);
    const path = [
      [1, 5],
      [2, 5],
      [3, 5],
      [3, 6],
      [3, 7],
      [3, 8],
    ];
    path.forEach(([x, y], i) => {
      if (i > 0) sim.step();
      expect(itemAt(sim, x!, y!)).toBe('iron_ore');
    });
    sim.step();
    expect(sim.snapshot().demands[0]!.delivered).toBe(1);
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('a full line advances as a unit at 1 item per tick', () => {
    const puzzle = makePuzzle({
      sources: [source(0, 5, 1, 'iron_ore', 1, 1)],
      demands: [demand(9, 5, 3, 'iron_ore', 1, 1)],
    });
    const sim = createSim(puzzle, line(1, 5, 8, 5, 1));
    sim.run(20);
    let last = sim.snapshot().demands[0]!.delivered;
    for (let i = 0; i < 20; i++) {
      sim.step();
      const s = sim.snapshot();
      expect(s.items).toHaveLength(8);
      expect(s.demands[0]!.delivered).toBe(last + 1);
      last = s.demands[0]!.delivered;
    }
  });

  it('a closed loop of full belts rotates', () => {
    // A merger at (1,1) facing east feeds a 4-tile ring; a source tops it up.
    const puzzle = makePuzzle({ sources: [source(0, 1, 1, 'iron_ore', 1, 1)] });
    const ring = [{ type: 'merger' as const, pos: { x: 1, y: 1 }, rot: 1 as const }, belt(2, 1, 2), belt(2, 2, 3), belt(1, 2, 0)];
    const sim = createSim(puzzle, ring);
    sim.run(10);
    const next: Record<string, string> = { '1,1': '2,1', '2,1': '2,2', '2,2': '1,2', '1,2': '1,1' };
    for (let i = 0; i < 8; i++) {
      expect(sim.snapshot().items).toHaveLength(4);
      sim.step();
      const s2 = sim.snapshot();
      expect(s2.items).toHaveLength(4);
      for (const it of s2.items) expect(next[`${it.from.x},${it.from.y}`]).toBe(`${it.pos.x},${it.pos.y}`);
    }
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('head-on belts jam with "rejected" (recorded once)', () => {
    const puzzle = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore')] });
    const sim = createSim(puzzle, [belt(1, 5, 1), belt(2, 5, 3)]);
    sim.run(30);
    const { jams, items } = sim.snapshot();
    expect(jams).toHaveLength(1);
    expect(jams[0]).toMatchObject({ pos: { x: 1, y: 5 }, item: 'iron_ore', reason: 'rejected' });
    expect(items).toHaveLength(1); // the stuck item; the source just waits
  });

  it('belt into empty floor jams with "dead-end"', () => {
    const puzzle = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore')] });
    const sim = createSim(puzzle, line(1, 5, 3, 5, 1));
    sim.run(20);
    const { jams } = sim.snapshot();
    expect(jams).toHaveLength(1);
    expect(jams[0]).toMatchObject({ pos: { x: 3, y: 5 }, reason: 'dead-end' });
    expect(itemAt(sim, 1, 5)).toBe('iron_ore');
    expect(itemAt(sim, 2, 5)).toBe('iron_ore');
  });

  it('belt into terrain, the grid edge or a source is a dead-end', () => {
    const p1 = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore')], terrain: [{ x: 3, y: 5 }] });
    const s1 = createSim(p1, line(1, 5, 2, 5, 1));
    s1.run(10);
    expect(s1.snapshot().jams[0]!.reason).toBe('dead-end');

    // the last buildable tile, pointing at the (empty) edge ring
    const p2 = makePuzzle({ sources: [source(16, 5, 1, 'iron_ore')] });
    const s2 = createSim(p2, line(17, 5, 18, 5, 1));
    s2.run(10);
    expect(s2.snapshot().jams[0]).toMatchObject({ pos: { x: 18, y: 5 }, reason: 'dead-end' });

    const p3 = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore'), source(5, 5, 1, 'iron_ore')] });
    const s3 = createSim(p3, line(1, 5, 4, 5, 1));
    s3.run(10);
    expect(s3.snapshot().jams[0]).toMatchObject({ pos: { x: 4, y: 5 }, reason: 'dead-end' });
  });

  it('demand: wrong item is "wrong-item", wrong side is "rejected"', () => {
    const p = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore')], demands: [demand(4, 5, 3, 'copper_plate')] });
    const s = createSim(p, line(1, 5, 3, 5, 1));
    s.run(10);
    expect(s.snapshot().jams[0]).toMatchObject({ pos: { x: 3, y: 5 }, reason: 'wrong-item' });

    // the demand accepts from the west only; feed it from the north
    const p2 = makePuzzle({ sources: [source(4, 2, 2, 'iron_ore')], demands: [demand(4, 5, 3, 'iron_ore')] });
    const s2 = createSim(p2, line(4, 3, 4, 4, 2));
    s2.run(10);
    expect(s2.snapshot().jams[0]).toMatchObject({ pos: { x: 4, y: 4 }, reason: 'rejected' });
  });

  it('a belt accepts from its side', () => {
    const puzzle = makePuzzle({
      sources: [source(3, 4, 2, 'iron_ore', 1, 6)],
      demands: [demand(6, 5, 3, 'iron_ore')],
    });
    const sim = createSim(puzzle, line(3, 5, 5, 5, 1));
    const t = trace(sim, 3, 5, 6);
    expect(t[5]).toBe('iron_ore');
    sim.run(4);
    expect(sim.snapshot().demands[0]!.delivered).toBe(1);
  });

  it('a belt facing a merger side is accepted; belt into a splitter side is rejected', () => {
    const puzzle = makePuzzle({ sources: [source(4, 3, 2, 'iron_ore')] });
    // splitter at (4,5) facing east; belt feeds it from the north (a side) -> rejected
    const sim = createSim(puzzle, [belt(4, 4, 2), { type: 'splitter', pos: { x: 4, y: 5 }, rot: 1 }]);
    sim.run(10);
    expect(sim.snapshot().jams[0]).toMatchObject({ pos: { x: 4, y: 4 }, reason: 'rejected' });
  });
});
