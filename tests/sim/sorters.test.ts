import { describe, expect, it } from 'vitest';
import { PARTS } from '../../src/shared/catalog';
import { opposite, placementPorts, step } from '../../src/shared/geometry';
import type { Dir, Rotation } from '../../src/shared/types';
import { createSim } from '../../src/sim';
import { belt, disposal, itemAt, makePuzzle, merger, sorter, source } from './helpers';

function sorterRig(rot: Rotation, sourceItem: string) {
  const p = sorter(8, 8, rot, 'iron_plate');
  const ports = placementPorts(p);
  const inP = ports.find((w) => w.kind === 'in')!;
  const outP = ports.find((w) => w.kind === 'out')!;
  const rejP = ports.find((w) => w.kind === 'reject')!;
  const legs = [outP, rejP].map((w) => {
    const beltTile = w.neighbor;
    const end = step(beltTile, w.side);
    return { belt: belt(beltTile.x, beltTile.y, w.side), tile: beltTile, disposal: disposal(end.x, end.y, opposite(w.side)) };
  });
  const puzzle = makePuzzle({
    sources: [source(inP.neighbor.x, inP.neighbor.y, opposite(inP.side), sourceItem)],
    disposals: legs.map((l) => l.disposal),
  });
  const sim = createSim(puzzle, [p, legs[0]!.belt, legs[1]!.belt]);
  return { sim, outTile: legs[0]!.tile, rejTile: legs[1]!.tile };
}

describe('sorter', () => {
  it('has the expected shape: 1x2, in west, out east, reject east of the second tile', () => {
    expect(PARTS.sorter.w).toBe(1);
    expect(PARTS.sorter.h).toBe(2);
  });

  for (const rot of [0, 1, 2, 3] as Rotation[]) {
    it(`routes the filter item forward and others to the reject port (rot ${rot})`, () => {
      const hit = (sim: ReturnType<typeof createSim>, t: { x: number; y: number }, n: number) => {
        let seen = 0;
        for (let i = 0; i < n; i++) {
          sim.step();
          if (itemAt(sim, t.x, t.y)) seen++;
        }
        return seen;
      };
      const a = sorterRig(rot, 'iron_plate');
      const seenOut = hit(a.sim, a.outTile, 20);
      expect(seenOut).toBeGreaterThan(10);
      expect(itemAt(a.sim, a.rejTile.x, a.rejTile.y)).toBeNull();
      expect(a.sim.snapshot().jams).toHaveLength(0);

      const b = sorterRig(rot, 'copper_plate');
      const seenRej = hit(b.sim, b.rejTile, 20);
      expect(seenRej).toBeGreaterThan(10);
      expect(itemAt(b.sim, b.outTile.x, b.outTile.y)).toBeNull();
      expect(b.sim.snapshot().jams).toHaveLength(0);
    });
  }

  it('the two reject-side tiles map to two distinct lanes at every rotation', () => {
    for (const r of [0, 1, 2, 3] as Rotation[]) {
      const ports = placementPorts(sorter(8, 8, r, 'x'));
      const o = ports.find((w) => w.kind === 'out')!;
      const j = ports.find((w) => w.kind === 'reject')!;
      expect(o.side).toBe(j.side as Dir);
      expect(o.neighbor).not.toEqual(j.neighbor);
    }
  });

  it('splits a mixed stream into two lanes', () => {
    const puzzle = makePuzzle({
      sources: [source(3, 3, 2, 'iron_plate'), source(3, 7, 0, 'copper_plate')],
      disposals: [disposal(6, 5, 3), disposal(6, 6, 3)],
    });
    const placements = [belt(3, 4, 2), belt(3, 6, 0), merger(3, 5, 1), sorter(4, 5, 0, 'iron_plate'), belt(5, 5, 1), belt(5, 6, 1)];
    const sim = createSim(puzzle, placements);
    sim.run(10);
    let fwd = 0;
    let side = 0;
    for (let i = 0; i < 40; i++) {
      sim.step();
      const f = itemAt(sim, 5, 5);
      const s = itemAt(sim, 5, 6);
      if (f) {
        expect(f).toBe('iron_plate');
        fwd++;
      }
      if (s) {
        expect(s).toBe('copper_plate');
        side++;
      }
    }
    expect(fwd).toBeGreaterThan(15);
    expect(side).toBeGreaterThan(15);
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('jams when the chosen lane points at nothing', () => {
    const puzzle = makePuzzle({ sources: [source(3, 5, 1, 'copper_plate')] });
    // filter is iron_plate, so copper goes to the reject lane, which has no belt
    const sim = createSim(puzzle, [sorter(4, 5, 0, 'iron_plate'), belt(5, 5, 1)]);
    sim.run(10);
    expect(sim.snapshot().jams[0]).toMatchObject({ pos: { x: 4, y: 5 }, reason: 'dead-end' });
  });
});
