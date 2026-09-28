// Public contract of the simulation engine. The game UI, generator and tests
// depend only on this file; see docs/sim-spec.md for the exact semantics.

import type { Dir, ItemId, Placement, Puzzle, RecipeId, Scores, Vec } from '../shared/types';

export type LayoutErrorCode =
  | 'out-of-bounds'
  | 'edge' // part covers the outer ring, which is reserved for ports
  | 'overlap' // two placements share a tile, or a placement covers a fixed element / terrain
  | 'part-not-allowed' // part type not in puzzle.parts
  | 'bad-recipe' // machine missing a recipe, recipe for another machine, or not in puzzle.recipes
  | 'missing-filter' // sorter without a filter item
  | 'multiple-feeders'; // more than one part outputs into a belt (use a merger)

export interface LayoutError {
  code: LayoutErrorCode;
  /** Index into the placements array, when the error belongs to one placement. */
  placement?: number;
  pos?: Vec;
  message: string;
}

export type JamReason =
  | 'wrong-item' // item reached a port that never accepts that item type
  | 'dead-end' // belt/merger/sorter output points at empty floor, terrain, the edge, or a non-port tile
  | 'rejected'; // output points into a part from a side it never accepts (e.g. head-on belts)

export interface Jam {
  tick: number;
  /** Tile holding the stuck item. */
  pos: Vec;
  item: ItemId;
  reason: JamReason;
}

/** One item for rendering. `from` is where it was at the start of the last tick. */
export interface ItemView {
  item: ItemId;
  pos: Vec;
  from: Vec;
}

export interface MachineView {
  placement: number;
  recipe: RecipeId;
  /** Items currently buffered per ingredient. */
  inputs: Record<ItemId, number>;
  /** Items waiting to leave via the output port(s). */
  outputs: Record<ItemId, number>;
  /** 0 when idle; otherwise ticks elapsed in the current craft. */
  progress: number;
  craftTicks: number;
  /** Craft finished but the output buffer is full. */
  stalled: boolean;
  /** Items held at one of this machine's input ports because that ingredient's buffer is full (backpressure). */
  waiting: ItemId[];
  /** Ingredients whose buffer is below the recipe count, i.e. why a craft can't start. */
  missing: ItemId[];
  /** Idle and unable to start, with an item waiting at a port while a different ingredient is missing, sustained for a few ticks. Diagnostic only. */
  deadlocked: boolean;
}

export interface Deadlock {
  /** Tick the machine was confirmed deadlocked in this episode. */
  tick: number;
  /** Placement index of the machine. */
  placement: number;
  waiting: ItemId[];
  missing: ItemId[];
}

export interface DemandView {
  index: number;
  /** Total correct items received since tick 0. */
  delivered: number;
  /** Correct items received inside the measurement window so far. */
  deliveredInWindow: number;
}

export interface SimSnapshot {
  tick: number;
  items: ItemView[];
  machines: MachineView[];
  demands: DemandView[];
  jams: Jam[];
  /** One entry per deadlock episode, in detection order. */
  deadlocks: Deadlock[];
  /** Tick the first product reached any demand port, or null. */
  firstDelivery: number | null;
}

export interface Sim {
  readonly puzzle: Puzzle;
  readonly placements: readonly Placement[];
  /** Advance one tick. */
  step(): void;
  /** Advance n ticks. */
  run(n: number): void;
  snapshot(): SimSnapshot;
}

export interface EvalResult {
  pass: boolean;
  layoutErrors: LayoutError[];
  jams: Jam[];
  /** Deadlock episodes seen during the run (diagnostic; does not affect pass). */
  deadlocks: Deadlock[];
  /** Per demand port: items delivered in the window vs. required. */
  demands: { index: number; delivered: number; required: number; met: boolean }[];
  /** Always computed (footprint/cost are static). latency is null if nothing was delivered. */
  scores: Omit<Scores, 'latency'> & { latency: number | null };
  ticksRun: number;
}

export interface SimModule {
  validateLayout(puzzle: Puzzle, placements: readonly Placement[]): LayoutError[];
  /** Throws if validateLayout reports errors. */
  createSim(puzzle: Puzzle, placements: readonly Placement[]): Sim;
  /** Runs warmup + window and scores the build. Never throws on bad layouts. */
  evaluate(puzzle: Puzzle, placements: readonly Placement[]): EvalResult;
  scoreStatic(placements: readonly Placement[]): { footprint: number; cost: number };
}

/** Handy for callers that want to know which way a 1×1 logistics part faces. */
export type Facing = Dir;
