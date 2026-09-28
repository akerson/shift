import { describe, expect, it } from 'vitest';
import sample from '../../puzzles/sample-smelt.json';
import type { Placement, Puzzle } from '../../src/shared/types';
import { createSim, evaluate, sim as simModule } from '../../src/sim';
import { belt, demand, line, machine, makePuzzle, merger, source, splitter } from './helpers';

const puzzle = sample as unknown as Puzzle;

/**
 * Source (0,9) -> east to a smelter at (4,9) -> around the terrain at (9,8),(9,9),(10,9)
 * via y=11 -> back up to y=9 -> demand (19,9).
 */
function solution(extraJog = false): Placement[] {
  const p: Placement[] = [
    ...line(1, 9, 3, 9, 1),
    machine('smelter', 4, 9, 0, 'smelt_iron'),
    belt(6, 9, 1),
    belt(7, 9, 1),
    belt(8, 9, 2),
    belt(8, 10, 2),
    belt(8, 11, 1),
    belt(9, 11, 1),
    belt(10, 11, 1),
    belt(11, 11, 0),
    belt(11, 10, 0),
    belt(11, 9, 1),
    ...line(12, 9, 18, 9, 1),
  ];
  if (extraJog) {
    // lengthen the path by 2 (shifts the delivery phase): detour (12,9) up and back
    return p.filter((x) => !(x.pos.x >= 12 && x.pos.x <= 14 && x.pos.y === 9)).concat([
      belt(12, 9, 1),
      belt(13, 9, 0),
      belt(13, 8, 1),
      belt(14, 8, 2),
      belt(14, 9, 1),
    ]);
  }
  return p;
}

describe('evaluate', () => {
  it('a hand-built solution to sample-smelt passes, whatever the delivery phase', () => {
    // 200 / 6 is not an integer: a steady 1-per-6 line delivers 33 or 34 items in the window depending on
    // phase. The required count is floor(rate * window) = 33, so both routes pass.
    for (const extraJog of [false, true]) {
      const r = evaluate(puzzle, solution(extraJog));
      expect(r.layoutErrors).toEqual([]);
      expect(r.jams).toEqual([]);
      expect(r.demands[0]!.required).toBe(33);
      expect(r.demands[0]!.delivered).toBeGreaterThanOrEqual(33);
      expect(r.pass).toBe(true);
      expect(r.ticksRun).toBe(300);
    }
  });

  it('reports footprint, cost and latency correctly', () => {
    const r = evaluate(puzzle, solution(false));
    // belts: 3 + 2 + 3 + 3 + 1... count them from the placements
    const pl = solution(false);
    const belts = pl.filter((p) => p.type === 'belt').length;
    expect(r.scores.cost).toBe(belts * 1 + 20);
    // x 1..18, y 9..11 (smelter covers y 9..10) -> 18 * 3
    expect(r.scores.footprint).toBe(18 * 3);
    // 6 ticks to first item, then one tile per tick; the smelter takes 1 tick in, 6 crafting, 1 out
    const s = createSim(puzzle, pl);
    let first: number | null = null;
    for (let i = 0; i < 100 && first === null; i++) {
      s.step();
      first = s.snapshot().firstDelivery;
    }
    expect(r.scores.latency).toBe(first);
    // path: source emits on tick 6 onto (1,9); 3 belts (ticks 6..8 on 1,2,3), enters smelter tick 9,
    // craft starts tick 10, finishes tick 16 and outputs onto (6,9); then 17 belts in total (last one at tick 32) and the demand at tick 33.
    expect(first).toBe(16 + 17);
  });

  it('an under-rate solution fails without jams', () => {
    const slow = { ...puzzle, sources: [{ ...puzzle.sources[0]!, rate: { count: 1, ticks: 12 } }] };
    const r = evaluate(slow, solution(false));
    expect(r.pass).toBe(false);
    expect(r.jams).toEqual([]);
    expect(r.demands[0]!.met).toBe(false);
    expect(r.demands[0]!.delivered).toBeLessThan(r.demands[0]!.required);
    expect(r.demands[0]!.required).toBe(33);
  });

  it('a build that jams fails even if items arrive', () => {
    const jammy = [...solution(false), belt(1, 8, 1)]; // stray belt: dead-end but no item ever reaches it
    const r = evaluate(puzzle, jammy);
    expect(r.jams).toEqual([]); // a stray, unfed belt is harmless

    const pz = makePuzzle({
      sources: [source(0, 5, 1, 'iron_ore', 1, 6)],
      demands: [demand(9, 5, 3, 'iron_ore', 1, 6)],
      warmupTicks: 20,
      windowTicks: 60,
    });
    // works, but a splitter also leaks items into a dead-end belt
    const leaky = [belt(1, 5, 1), splitter(2, 5, 1), ...line(3, 5, 8, 5, 1), belt(2, 6, 2)];
    const r2 = evaluate(pz, leaky);
    expect(r2.jams.length).toBeGreaterThanOrEqual(1);
    expect(r2.pass).toBe(false);
  });

  it('an empty build fails and never throws', () => {
    const r = evaluate(puzzle, []);
    expect(r.pass).toBe(false);
    expect(r.scores).toEqual({ footprint: 0, cost: 0, latency: null });
    expect(r.demands[0]!.delivered).toBe(0);
  });

  it('bad layouts return layoutErrors instead of throwing', () => {
    const r = evaluate(puzzle, [belt(9, 9, 1)]);
    expect(r.pass).toBe(false);
    expect(r.layoutErrors.map((e) => e.code)).toEqual(['overlap']);
    expect(r.ticksRun).toBe(0);
    expect(r.scores.cost).toBe(1);
  });

  it('counts only deliveries inside the window', () => {
    const pz = makePuzzle({
      sources: [source(0, 5, 1, 'iron_ore', 1, 1)],
      demands: [demand(9, 5, 3, 'iron_ore', 1, 1)],
      warmupTicks: 50,
      windowTicks: 40,
    });
    const r = evaluate(pz, line(1, 5, 8, 5, 1));
    expect(r.demands[0]).toEqual({ index: 0, delivered: 40, required: 40, met: true });
    expect(r.pass).toBe(true);
    expect(r.scores.latency).toBe(9);
  });

  it('SimModule facade exposes everything', () => {
    expect(Object.keys(simModule).sort()).toEqual(['createSim', 'evaluate', 'scoreStatic', 'validateLayout']);
  });

  it('a merger-based two-source factory can pass with a wrong-item-free layout', () => {
    const pz = makePuzzle({
      sources: [source(0, 4, 1, 'iron_ore', 1, 2), source(0, 6, 1, 'iron_ore', 1, 2)],
      demands: [demand(9, 5, 3, 'iron_ore', 1, 1)],
      warmupTicks: 30,
      windowTicks: 60,
    });
    const pl = [belt(1, 4, 1), belt(2, 4, 1), belt(3, 4, 2), belt(1, 6, 1), belt(2, 6, 1), belt(3, 6, 0), merger(3, 5, 1), ...line(4, 5, 8, 5, 1)];
    const r = evaluate(pz, pl);
    expect(r.jams).toEqual([]);
    expect(r.pass).toBe(true);
  });
});
