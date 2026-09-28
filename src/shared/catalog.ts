// The fixed catalog: items, recipes and part definitions.
// Changing a recipe or part changes old puzzles' behaviour, so treat entries
// as append-only once daily puzzles ship; bump CATALOG_VERSION when you must.

import type { ItemId, PartDef, PartType, Recipe, RecipeId } from './types';

export const CATALOG_VERSION = '1';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Raw items only ever come from sources. */
  raw: boolean;
  /** Display colour for rendering. */
  color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', raw: true, color: '#8a6f5c' },
  copper_ore: { id: 'copper_ore', name: 'Copper Ore', raw: true, color: '#c46a3a' },
  stone: { id: 'stone', name: 'Stone', raw: true, color: '#9a9a8a' },
  crude: { id: 'crude', name: 'Crude Oil', raw: true, color: '#2b2b33' },

  iron_plate: { id: 'iron_plate', name: 'Iron Plate', raw: false, color: '#b8c0c8' },
  copper_plate: { id: 'copper_plate', name: 'Copper Plate', raw: false, color: '#e08a50' },
  brick: { id: 'brick', name: 'Brick', raw: false, color: '#b5523b' },
  plastic: { id: 'plastic', name: 'Plastic', raw: false, color: '#e8e8f0' },
  gas: { id: 'gas', name: 'Gas', raw: false, color: '#7fb07f' },

  gear: { id: 'gear', name: 'Gear', raw: false, color: '#7d8791' },
  wire: { id: 'wire', name: 'Wire', raw: false, color: '#f0a040' },
  rod: { id: 'rod', name: 'Rod', raw: false, color: '#6c7a89' },

  circuit: { id: 'circuit', name: 'Circuit', raw: false, color: '#3fa34d' },
  motor: { id: 'motor', name: 'Motor', raw: false, color: '#4a6fa5' },
  frame: { id: 'frame', name: 'Frame', raw: false, color: '#a0785a' },
  chip: { id: 'chip', name: 'Chip', raw: false, color: '#2f7fbf' },
  robot: { id: 'robot', name: 'Robot', raw: false, color: '#d4c040' },
};

const recipeList: Recipe[] = [
  // Smelter: 1 input, 1 output
  { id: 'smelt_iron', machine: 'smelter', inputs: { iron_ore: 1 }, output: { item: 'iron_plate', count: 1 }, craftTicks: 6 },
  { id: 'smelt_copper', machine: 'smelter', inputs: { copper_ore: 1 }, output: { item: 'copper_plate', count: 1 }, craftTicks: 6 },
  { id: 'smelt_brick', machine: 'smelter', inputs: { stone: 2 }, output: { item: 'brick', count: 1 }, craftTicks: 8 },

  // Press: 1 input, 1 output
  { id: 'press_gear', machine: 'press', inputs: { iron_plate: 2 }, output: { item: 'gear', count: 1 }, craftTicks: 8 },
  { id: 'press_wire', machine: 'press', inputs: { copper_plate: 1 }, output: { item: 'wire', count: 2 }, craftTicks: 4 },
  { id: 'press_rod', machine: 'press', inputs: { iron_plate: 1 }, output: { item: 'rod', count: 1 }, craftTicks: 6 },

  // Refinery: 1 input, product + byproduct
  { id: 'refine_plastic', machine: 'refinery', inputs: { crude: 2 }, output: { item: 'plastic', count: 1 }, byproduct: { item: 'gas', count: 1 }, craftTicks: 8 },

  // Assembler: 2 ingredients, 1 output
  { id: 'asm_circuit', machine: 'assembler', inputs: { wire: 3, iron_plate: 1 }, output: { item: 'circuit', count: 1 }, craftTicks: 12 },
  { id: 'asm_motor', machine: 'assembler', inputs: { gear: 1, rod: 1 }, output: { item: 'motor', count: 1 }, craftTicks: 12 },
  { id: 'asm_frame', machine: 'assembler', inputs: { brick: 2, rod: 1 }, output: { item: 'frame', count: 1 }, craftTicks: 12 },
  { id: 'asm_chip', machine: 'assembler', inputs: { circuit: 1, plastic: 1 }, output: { item: 'chip', count: 1 }, craftTicks: 16 },
  { id: 'asm_robot', machine: 'assembler', inputs: { circuit: 1, motor: 1 }, output: { item: 'robot', count: 1 }, craftTicks: 24 },
];

export const RECIPES: Record<RecipeId, Recipe> = Object.fromEntries(recipeList.map((r) => [r.id, r]));

/**
 * Part definitions at rotation 0. Machine port layouts are fixed per type;
 * rotating a part rotates its footprint and ports together (see geometry.ts).
 *
 * 1×1 logistics parts (belt, merger, splitter) have no fixed ports; their
 * rotation is their facing direction:
 *   - belt:     accepts from any non-front side (one feeder only), outputs forward
 *   - merger:   accepts from the three non-front sides, alternates, outputs forward
 *   - splitter: accepts from the back, alternates between the other three sides
 */
export const PARTS: Record<PartType, PartDef> = {
  belt: { type: 'belt', w: 1, h: 1, ports: [], cost: 1 },
  merger: { type: 'merger', w: 1, h: 1, ports: [], cost: 3 },
  splitter: { type: 'splitter', w: 1, h: 1, ports: [], cost: 3 },
  // Items enter from the west of the top tile. The filtered item continues
  // east from the top tile; everything else is shunted to the bottom tile and
  // exits east from there, giving two parallel lanes.
  sorter: {
    type: 'sorter',
    w: 1,
    h: 2,
    cost: 5,
    ports: [
      { dx: 0, dy: 0, side: 3, kind: 'in' },
      { dx: 0, dy: 0, side: 1, kind: 'out' },
      { dx: 0, dy: 1, side: 1, kind: 'reject' },
    ],
  },
  // Input and output on opposite sides.
  smelter: {
    type: 'smelter',
    w: 2,
    h: 2,
    cost: 20,
    inputBuffer: 2,
    ports: [
      { dx: 0, dy: 0, side: 3, kind: 'in' },
      { dx: 1, dy: 0, side: 1, kind: 'out' },
    ],
  },
  // Input and output on adjacent sides.
  press: {
    type: 'press',
    w: 2,
    h: 2,
    cost: 20,
    inputBuffer: 2,
    ports: [
      { dx: 0, dy: 0, side: 3, kind: 'in' },
      { dx: 1, dy: 1, side: 2, kind: 'out' },
    ],
  },
  // Two inputs on different sides (west, north); output east.
  // Either input port accepts either ingredient.
  assembler: {
    type: 'assembler',
    w: 3,
    h: 3,
    cost: 40,
    inputBuffer: 2,
    ports: [
      { dx: 0, dy: 1, side: 3, kind: 'in' },
      { dx: 1, dy: 0, side: 0, kind: 'in' },
      { dx: 2, dy: 1, side: 1, kind: 'out' },
    ],
  },
  // 3 wide, 2 tall. Product exits east, byproduct exits south.
  refinery: {
    type: 'refinery',
    w: 3,
    h: 2,
    cost: 30,
    inputBuffer: 2,
    ports: [
      { dx: 0, dy: 0, side: 3, kind: 'in' },
      { dx: 2, dy: 0, side: 1, kind: 'out' },
      { dx: 1, dy: 1, side: 2, kind: 'byproduct' },
    ],
  },
};

export const MACHINE_TYPES = ['smelter', 'press', 'assembler', 'refinery'] as const;

export function isMachine(t: PartType): t is (typeof MACHINE_TYPES)[number] {
  return (MACHINE_TYPES as readonly string[]).includes(t);
}

/**
 * How many of `item` a machine running `recipe` can hold in its input buffer.
 * "2 crafts' worth" — so a recipe needing 3 wire buffers 6.
 */
export function bufferCapacity(recipe: Recipe, item: ItemId): number {
  const per = recipe.inputs[item] ?? 0;
  const def = PARTS[recipe.machine];
  return per * (def.inputBuffer ?? 2);
}
