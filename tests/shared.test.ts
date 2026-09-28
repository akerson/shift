import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEMS, PARTS, RECIPES, bufferCapacity } from '../src/shared/catalog';
import { footprint, placementPorts, placementTiles, rotatedPorts } from '../src/shared/geometry';
import { validatePuzzle } from '../src/shared/puzzle';
import { createRng, dailySeed } from '../src/shared/rng';
import type { Puzzle } from '../src/shared/types';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng('x');
    const b = createRng('x');
    const c = createRng('y');
    const sa = Array.from({ length: 5 }, () => a.u32());
    expect(Array.from({ length: 5 }, () => b.u32())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.u32())).not.toEqual(sa);
  });

  it('pins the sequence so daily puzzles never silently change', () => {
    const r = createRng(dailySeed('2026-01-01', '1'));
    expect([r.u32(), r.u32(), r.u32()]).toMatchInlineSnapshot(`
      [
        2387686174,
        2877212476,
        2606568100,
      ]
    `);
  });

  it('int stays in range', () => {
    const r = createRng('range');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe('catalog', () => {
  it('recipes reference known items and matching machines', () => {
    for (const r of Object.values(RECIPES)) {
      for (const item of Object.keys(r.inputs)) expect(ITEMS[item], `${r.id} input ${item}`).toBeDefined();
      expect(ITEMS[r.output.item]).toBeDefined();
      if (r.byproduct) expect(r.machine).toBe('refinery');
      if (r.machine === 'assembler') expect(Object.keys(r.inputs)).toHaveLength(2);
      else expect(Object.keys(r.inputs)).toHaveLength(1);
    }
  });

  it('buffer capacity is two crafts of each ingredient', () => {
    expect(bufferCapacity(RECIPES.asm_circuit!, 'wire')).toBe(6);
    expect(bufferCapacity(RECIPES.asm_circuit!, 'iron_plate')).toBe(2);
  });

  it('every machine port sits on its footprint edge', () => {
    for (const def of Object.values(PARTS)) {
      for (const p of def.ports) {
        expect(p.dx).toBeLessThan(def.w);
        expect(p.dy).toBeLessThan(def.h);
      }
    }
  });
});

describe('geometry', () => {
  it('rotates footprints', () => {
    expect(footprint('refinery', 0)).toEqual({ w: 3, h: 2 });
    expect(footprint('refinery', 1)).toEqual({ w: 2, h: 3 });
  });

  it('rotation 0 is the catalog layout', () => {
    for (const t of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
      expect(rotatedPorts(t, 0)).toEqual(PARTS[t].ports);
    }
  });

  it('rotating a smelter 90° puts the input on the north and output on the south', () => {
    const ports = rotatedPorts('smelter', 1);
    expect(ports).toEqual([
      { dx: 1, dy: 0, side: 0, kind: 'in' },
      { dx: 1, dy: 1, side: 2, kind: 'out' },
    ]);
  });

  it('places ports in world space', () => {
    const p = { type: 'smelter' as const, pos: { x: 5, y: 5 }, rot: 0 as const };
    expect(placementTiles(p)).toHaveLength(4);
    const [inp, out] = placementPorts(p);
    expect(inp!.neighbor).toEqual({ x: 4, y: 5 });
    expect(out!.neighbor).toEqual({ x: 7, y: 5 });
  });
});

describe('puzzle files', () => {
  const dir = new URL('../puzzles/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(`${f} is valid`, () => {
      const p = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Puzzle;
      expect(validatePuzzle(p)).toEqual([]);
    });
  }
});
