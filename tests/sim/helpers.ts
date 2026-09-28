import type { Dir, Placement, Puzzle, Rotation, Source, DemandPort, DisposalPort } from '../../src/shared/types';
import type { Sim } from '../../src/sim/api';

export function makePuzzle(over: Partial<Puzzle> = {}): Puzzle {
  return {
    format: 1,
    id: 'test',
    number: 0,
    width: 20,
    height: 20,
    terrain: [],
    sources: [],
    demands: [],
    disposals: [],
    recipes: [
      'smelt_iron', 'smelt_copper', 'smelt_brick', 'press_gear', 'press_wire', 'press_rod',
      'refine_plastic', 'asm_circuit', 'asm_motor', 'asm_frame', 'asm_chip', 'asm_robot',
    ],
    parts: ['belt', 'merger', 'splitter', 'sorter', 'smelter', 'press', 'assembler', 'refinery'],
    warmupTicks: 100,
    windowTicks: 200,
    ...over,
  };
}

export const belt = (x: number, y: number, rot: Dir): Placement => ({ type: 'belt', pos: { x, y }, rot });
export const merger = (x: number, y: number, rot: Dir): Placement => ({ type: 'merger', pos: { x, y }, rot });
export const splitter = (x: number, y: number, rot: Dir): Placement => ({ type: 'splitter', pos: { x, y }, rot });
export const sorter = (x: number, y: number, rot: Rotation, filter: string): Placement => ({
  type: 'sorter',
  pos: { x, y },
  rot,
  filter,
});
export const machine = (
  type: 'smelter' | 'press' | 'assembler' | 'refinery',
  x: number,
  y: number,
  rot: Rotation,
  recipe: string,
): Placement => ({ type, pos: { x, y }, rot, recipe });

/** Straight run of belts from (x0,y0) to (x1,y1) inclusive, all facing `rot`. */
export function line(x0: number, y0: number, x1: number, y1: number, rot: Dir): Placement[] {
  const out: Placement[] = [];
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  for (;;) {
    out.push(belt(x, y, rot));
    if (x === x1 && y === y1) break;
    x += dx;
    y += dy;
  }
  return out;
}

export const source = (x: number, y: number, dir: Dir, item: string, count = 1, ticks = 1): Source => ({
  pos: { x, y },
  dir,
  item,
  rate: { count, ticks },
});
export const demand = (x: number, y: number, dir: Dir, item: string, count = 1, ticks = 6): DemandPort => ({
  pos: { x, y },
  dir,
  item,
  rate: { count, ticks },
});
export const disposal = (x: number, y: number, dir: Dir): DisposalPort => ({ pos: { x, y }, dir });

/** Item at tile, or null. */
export function itemAt(sim: Sim, x: number, y: number): string | null {
  return sim.snapshot().items.find((i) => i.pos.x === x && i.pos.y === y)?.item ?? null;
}

/** Runs the sim and collects the per-tick item seen at a tile (index 0 = tick 1). */
export function trace(sim: Sim, x: number, y: number, ticks: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    out.push(itemAt(sim, x, y));
  }
  return out;
}
