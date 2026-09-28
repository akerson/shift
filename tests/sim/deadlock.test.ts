import { describe, expect, it } from 'vitest';
import { createSim, evaluate } from '../../src/sim';
import { belt, demand, line, machine, makePuzzle, merger, source } from './helpers';

// Assembler (rot 0) at (5,5): west in (5,6) <- belt (4,6); north in (6,5) <- belt (6,4); out (7,6) -> belt (8,6).
// Wire and plates share ONE belt into the west port via a merger at (3,6).
function mixedRig(wireTicks: number, plateTicks: number) {
  const puzzle = makePuzzle({
    sources: [source(0, 6, 1, 'wire', 1, wireTicks), source(3, 0, 2, 'iron_plate', 1, plateTicks)],
    demands: [demand(19, 6, 3, 'circuit', 1, 12)],
  });
  const placements = [
    ...line(1, 6, 2, 6, 1),
    merger(3, 6, 1),
    belt(4, 6, 1),
    ...line(3, 1, 3, 5, 2),
    machine('assembler', 5, 5, 0, 'asm_circuit'),
    ...line(8, 6, 18, 6, 1),
  ];
  return { puzzle, placements };
}

describe('deadlock diagnostics', () => {
  it('a mixed belt with plates over-supplied deadlocks and reports why', () => {
    const { puzzle, placements } = mixedRig(6, 2);
    const sim = createSim(puzzle, placements);
    sim.run(400);
    const s = sim.snapshot();
    const m = s.machines[0]!;
    expect(m.deadlocked).toBe(true);
    expect(m.waiting).toEqual(['iron_plate']);
    expect(m.missing).toEqual(['wire']);
    expect(s.jams).toHaveLength(0);
    expect(s.deadlocks).toHaveLength(1);
    expect(s.deadlocks[0]).toMatchObject({ placement: 9, waiting: ['iron_plate'], missing: ['wire'] });
    expect(s.deadlocks[0]!.tick).toBeGreaterThan(0);
    expect(s.deadlocks[0]!.tick).toBeLessThanOrEqual(400);
    // Diagnostic only: pass/fail is decided by rates and jams.
    const ev = evaluate(puzzle, placements);
    expect(ev.deadlocks).toHaveLength(1);
    expect(ev.jams).toHaveLength(0);
    expect(ev.pass).toBe(false);
  });

  it('records each episode once, not every tick', () => {
    const { puzzle, placements } = mixedRig(6, 2);
    const sim = createSim(puzzle, placements);
    sim.run(200);
    const n = sim.snapshot().deadlocks.length;
    sim.run(200);
    expect(sim.snapshot().deadlocks).toHaveLength(n);
  });

  it('a correct supply ratio does not deadlock', () => {
    const { puzzle, placements } = mixedRig(4, 12);
    const sim = createSim(puzzle, placements);
    for (let i = 0; i < 400; i++) {
      sim.step();
      expect(sim.snapshot().machines[0]!.deadlocked).toBe(false);
    }
    const s = sim.snapshot();
    expect(s.deadlocks).toHaveLength(0);
    expect(s.demands[0]!.delivered).toBeGreaterThan(10);
  });

  it('a starved machine (nothing supplied, nothing waiting) is not deadlocked', () => {
    const { puzzle, placements } = mixedRig(6, 2);
    const sim = createSim({ ...puzzle, sources: [] }, placements);
    sim.run(100);
    const m = sim.snapshot().machines[0]!;
    expect(m.waiting).toEqual([]);
    expect(m.missing).toEqual(['wire', 'iron_plate']);
    expect(m.deadlocked).toBe(false);
    expect(sim.snapshot().deadlocks).toEqual([]);
  });
});
