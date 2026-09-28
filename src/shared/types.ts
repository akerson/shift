// Core types shared by the simulation, generator, game UI and tests.
// Everything here must stay plain data (JSON-serialisable) and DOM-free.

/** Grid coordinates. x grows to the right (east), y grows downward (south). */
export interface Vec {
  x: number;
  y: number;
}

/** 0 = North (-y), 1 = East (+x), 2 = South (+y), 3 = West (-x). */
export type Dir = 0 | 1 | 2 | 3;

/** Quarter turns clockwise applied to a part's base (rotation 0) layout. */
export type Rotation = 0 | 1 | 2 | 3;

export type ItemId = string;
export type RecipeId = string;

export type MachineType = 'smelter' | 'press' | 'assembler' | 'refinery';
export type LogisticsType = 'belt' | 'merger' | 'splitter' | 'sorter';
export type PartType = LogisticsType | MachineType;

/**
 * A rate as an exact fraction: `count` items every `ticks` ticks.
 * Kept as integers so all rate maths is exact.
 */
export interface Rate {
  count: number;
  ticks: number;
}

export interface Recipe {
  id: RecipeId;
  machine: MachineType;
  /** Ingredient counts consumed per craft. Assemblers have exactly 2 distinct ingredients. */
  inputs: Record<ItemId, number>;
  /** Product made per craft. */
  output: { item: ItemId; count: number };
  /** Refinery only: byproduct made per craft, emitted from the byproduct port. */
  byproduct?: { item: ItemId; count: number };
  /** Ticks from start of craft to output being ready. */
  craftTicks: number;
}

export type PortKind = 'in' | 'out' | 'byproduct' | 'reject';

/**
 * A port on a multi-tile part, in the part's local rotation-0 frame.
 * `dx,dy` is the tile of the part the port sits on; `side` is the edge of
 * that tile the port faces. The connecting belt tile is the neighbour of
 * (dx,dy) in direction `side`.
 */
export interface PortDef {
  dx: number;
  dy: number;
  side: Dir;
  kind: PortKind;
}

export interface PartDef {
  type: PartType;
  /** Footprint at rotation 0. */
  w: number;
  h: number;
  /**
   * Ports at rotation 0. Belts, mergers and splitters have no fixed ports:
   * their behaviour is defined relative to their facing direction (see sim spec).
   */
  ports: PortDef[];
  cost: number;
  /** Max items buffered per ingredient (machines only). */
  inputBuffer?: number;
}

/**
 * A part the player (or reference builder) placed.
 * `pos` is the top-left tile of the rotated footprint.
 * For 1×1 logistics parts, `rot` is the facing (output) direction as a Dir.
 */
export interface Placement {
  type: PartType;
  pos: Vec;
  rot: Rotation;
  /** Machines: the recipe this machine runs. */
  recipe?: RecipeId;
  /** Sorters: the item that exits forward. */
  filter?: ItemId;
}

/** Fixed elements are single tiles on the floor edge, placed by the generator. */
export interface Source {
  pos: Vec;
  /** Direction items leave the source (toward the interior). */
  dir: Dir;
  item: ItemId;
  rate: Rate;
}

export interface DemandPort {
  pos: Vec;
  /** Side of the port tile that accepts items (facing the interior). */
  dir: Dir;
  item: ItemId;
  rate: Rate;
}

export interface DisposalPort {
  pos: Vec;
  dir: Dir;
}

export interface Scores {
  /** Area of the bounding box of all player-placed tiles. */
  footprint: number;
  /** Sum of part costs. */
  cost: number;
  /** Tick at which the first product reached any demand port. */
  latency: number;
}

export interface Puzzle {
  /** Schema version of this file format. */
  format: 1;
  /** ISO date (YYYY-MM-DD) for daily puzzles, or a slug for hand-made ones. */
  id: string;
  /** Sequential puzzle number shown in the share card (0 for hand-made). */
  number: number;
  title?: string;
  width: number;
  height: number;
  /** Blocked tiles. */
  terrain: Vec[];
  sources: Source[];
  demands: DemandPort[];
  disposals: DisposalPort[];
  /** Recipes available on this floor (subset of the catalog). */
  recipes: RecipeId[];
  /** Part types the player may use. */
  parts: PartType[];
  /** Ticks to run before the measurement window starts. */
  warmupTicks: number;
  /** Length of the measurement window in ticks. */
  windowTicks: number;
  par?: Scores;
  /** Reference builder's solution (not shown to players by default). */
  reference?: Placement[];
  /** Other known passing builds with different score trade-offs (design + regression checks). */
  alternates?: Placement[][];
  /** Designer notes: the intended insight, trade-offs between known solutions. */
  designNotes?: string;
  generator?: { version: string; seed: string };
}

/** A player's saved build for a puzzle. */
export interface Solution {
  puzzleId: string;
  placements: Placement[];
}
