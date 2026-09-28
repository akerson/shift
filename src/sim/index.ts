import type { Placement, Puzzle } from '../shared/types';
import { requiredDeliveries } from '../shared/puzzle';
import type { EvalResult, SimModule } from './api';
import { scoreStatic, validateLayout } from './layout';
import { createSim } from './world';

export { scoreStatic, validateLayout, createSim };
export type * from './api';

export function evaluate(puzzle: Puzzle, placements: readonly Placement[]): EvalResult {
  const { footprint, cost } = scoreStatic(placements);
  const layoutErrors = validateLayout(puzzle, placements);
  if (layoutErrors.length > 0) {
    return {
      pass: false,
      layoutErrors,
      jams: [],
      deadlocks: [],
      demands: puzzle.demands.map((d, index) => ({
        index,
        delivered: 0,
        required: requiredDeliveries(d.rate, puzzle.windowTicks),
        met: false,
      })),
      scores: { footprint, cost, latency: null },
      ticksRun: 0,
    };
  }
  const sim = createSim(puzzle, placements);
  const total = puzzle.warmupTicks + puzzle.windowTicks;
  sim.run(total);
  const snap = sim.snapshot();
  const demands = puzzle.demands.map((d, index) => {
    const got = snap.demands[index]!.deliveredInWindow;
    return {
      index,
      delivered: got,
      required: requiredDeliveries(d.rate, puzzle.windowTicks),
      met: got >= requiredDeliveries(d.rate, puzzle.windowTicks),
    };
  });
  return {
    pass: snap.jams.length === 0 && demands.every((d) => d.met),
    layoutErrors: [],
    jams: snap.jams,
    deadlocks: snap.deadlocks,
    demands,
    scores: { footprint, cost, latency: snap.firstDelivery },
    ticksRun: total,
  };
}

export const sim: SimModule = { validateLayout, createSim, evaluate, scoreStatic };
