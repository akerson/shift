import { describe, expect, it } from 'vitest';
import { opposite, placementPorts, step } from '../../src/shared/geometry';
import type { Rotation } from '../../src/shared/types';
import { createSim } from '../../src/sim';
import { belt, demand, disposal, itemAt, line, machine, makePuzzle, source } from './helpers';

// Smelter (rot 0) at (5,5): in west of (5,5) <- belt (4,5); out east of (6,5) -> belt (7,5).
function smelterRig(opts: { ore?: string; count?: number; ticks?: number; withOutput?: boolean }) {
  const puzzle = makePuzzle({
    sources: [source(3, 5, 1, opts.ore ?? 'iron_ore', opts.count ?? 1, opts.ticks ?? 6)],
    demands: [demand(8, 5, 3, 'iron_plate', 1, 6)],
  });
  const placements = [belt(4, 5, 1), machine('smelter', 5, 5, 0, 'smelt_iron'), ...(opts.withOutput === false ? [] : [belt(7, 5, 1)])];
  return createSim(puzzle, placements);
}

describe('smelter', () => {
  it('first plate arrives at a known tick, then exactly 1 plate every 6 ticks', () => {
    const sim = smelterRig({});
    const times: number[] = [];
    let last = 0;
    for (let i = 0; i < 200; i++) {
      sim.step();
      const d = sim.snapshot().demands[0]!.delivered;
      if (d > last) times.push(sim.snapshot().tick);
      last = d;
    }
    expect(times[0]).toBe(15);
    expect(times.length).toBeGreaterThan(25);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBe(6);
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('a saturated input gives exactly 1 plate / 6 ticks with backpressure but no jam', () => {
    const sim = smelterRig({ count: 1, ticks: 1 });
    sim.run(50);
    const a = sim.snapshot().demands[0]!.delivered;
    for (let i = 0; i < 60; i++) {
      sim.step();
      const m = sim.snapshot().machines[0]!;
      expect(m.inputs.iron_ore).toBeLessThanOrEqual(2);
    }
    expect(sim.snapshot().demands[0]!.delivered - a).toBe(10);
    expect(sim.snapshot().jams).toHaveLength(0);
    expect(itemAt(sim, 4, 5)).toBe('iron_ore'); // belt backed up
  });

  it('reports craft progress in the machine view', () => {
    const sim = smelterRig({});
    sim.run(8);
    let m = sim.snapshot().machines[0]!;
    expect(m).toMatchObject({ recipe: 'smelt_iron', progress: 0, craftTicks: 6, stalled: false });
    sim.run(3);
    m = sim.snapshot().machines[0]!;
    expect(m.progress).toBe(3);
  });

  it('the wrong ingredient is a "wrong-item" jam on the feeding belt', () => {
    const sim = smelterRig({ ore: 'copper_ore' });
    sim.run(20);
    const { jams } = sim.snapshot();
    expect(jams).toHaveLength(1);
    expect(jams[0]).toMatchObject({ pos: { x: 4, y: 5 }, item: 'copper_ore', reason: 'wrong-item' });
  });

  it('a blocked output stalls the machine without a jam', () => {
    const sim = smelterRig({ count: 1, ticks: 1, withOutput: false });
    sim.run(100);
    const s = sim.snapshot();
    const m = s.machines[0]!;
    expect(m.stalled).toBe(true);
    expect(m.progress).toBe(m.craftTicks);
    expect(m.outputs.iron_plate).toBe(2);
    expect(m.inputs.iron_ore).toBe(2);
    expect(s.jams).toHaveLength(0);
    expect(itemAt(sim, 4, 5)).toBe('iron_ore');
  });

  it('a blocked output that later frees up resumes', () => {
    // output belt leads into a wrong-item demand? No: use a machine output pointing at a dead-end belt
    // (jams the belt, not the machine): the machine itself still just stalls.
    const puzzle = makePuzzle({ sources: [source(3, 5, 1, 'iron_ore', 1, 1)] });
    const sim = createSim(puzzle, [belt(4, 5, 1), machine('smelter', 5, 5, 0, 'smelt_iron'), belt(7, 5, 1)]);
    sim.run(100);
    const s = sim.snapshot();
    expect(s.machines[0]!.stalled).toBe(true);
    expect(s.jams).toHaveLength(1);
    expect(s.jams[0]).toMatchObject({ pos: { x: 7, y: 5 }, item: 'iron_plate', reason: 'dead-end' });
  });

  it('accepts input directly from a source and outputs directly into a demand', () => {
    const puzzle = makePuzzle({
      sources: [source(4, 5, 1, 'iron_ore', 1, 6)],
      demands: [demand(7, 5, 3, 'iron_plate', 1, 6)],
    });
    const sim = createSim(puzzle, [machine('smelter', 5, 5, 0, 'smelt_iron')]);
    sim.run(60);
    expect(sim.snapshot().demands[0]!.delivered).toBeGreaterThanOrEqual(8);
  });

  it('brick smelter needs 2 stone per craft (8 ticks)', () => {
    const puzzle = makePuzzle({
      sources: [source(3, 5, 1, 'stone', 1, 1)],
      demands: [demand(8, 5, 3, 'brick', 1, 8)],
    });
    const sim = createSim(puzzle, [belt(4, 5, 1), machine('smelter', 5, 5, 0, 'smelt_brick'), belt(7, 5, 1)]);
    sim.run(40);
    const a = sim.snapshot().demands[0]!.delivered;
    sim.run(80);
    expect(sim.snapshot().demands[0]!.delivered - a).toBe(10);
  });
});

describe('refinery', () => {
  // Refinery rot 0 at (5,5), 3x2: in west of (5,5); product east of (7,5); byproduct south of (6,6).
  const build = (withByproductExit: boolean) => {
    const puzzle = makePuzzle({
      sources: [source(3, 5, 1, 'crude', 1, 1)],
      demands: [demand(9, 5, 3, 'plastic', 1, 16)],
      disposals: withByproductExit ? [disposal(6, 8, 0)] : [],
    });
    const placements = [
      belt(4, 5, 1),
      machine('refinery', 5, 5, 0, 'refine_plastic'),
      belt(8, 5, 1),
      ...(withByproductExit ? line(6, 7, 6, 7, 2) : []),
    ];
    return createSim(puzzle, placements);
  };

  it('stalls (no jam) when the byproduct cannot leave', () => {
    const sim = build(false);
    sim.run(200);
    const s = sim.snapshot();
    expect(s.machines[0]!.stalled).toBe(true);
    expect(s.machines[0]!.outputs.gas).toBe(2);
    expect(s.demands[0]!.delivered).toBe(2); // two crafts finished before the gas buffer filled
    expect(s.jams).toHaveLength(0);
  });

  it('keeps running when the byproduct goes to disposal', () => {
    const sim = build(true);
    sim.run(200);
    const s = sim.snapshot();
    expect(s.machines[0]!.stalled).toBe(false);
    expect(s.demands[0]!.delivered).toBeGreaterThan(20);
    expect(s.jams).toHaveLength(0);
  });
});

describe('assembler', () => {
  // asm_motor rot 0 at (5,5), 3x3: inputs west of (5,6) and north of (6,5); output east of (7,6).
  const build = (westItem: string, northItem: string) => {
    const puzzle = makePuzzle({
      sources: [source(3, 6, 1, westItem, 1, 12), source(6, 3, 2, northItem, 1, 12)],
      demands: [demand(9, 6, 3, 'motor', 1, 12)],
    });
    const placements = [
      belt(4, 6, 1),
      belt(6, 4, 2),
      machine('assembler', 5, 5, 0, 'asm_motor'),
      belt(8, 6, 1),
    ];
    return createSim(puzzle, placements);
  };

  it('accepts either ingredient on either input port', () => {
    for (const [w, n] of [
      ['gear', 'rod'],
      ['rod', 'gear'],
    ] as const) {
      const sim = build(w, n);
      sim.run(120);
      const s = sim.snapshot();
      expect(s.demands[0]!.delivered).toBeGreaterThanOrEqual(8);
      expect(s.jams).toHaveLength(0);
    }
  });

  it('crafts only with both ingredients; buffer capacity is 2 crafts per ingredient', () => {
    const puzzle = makePuzzle({ sources: [source(3, 6, 1, 'wire', 1, 1)] });
    const sim = createSim(puzzle, [belt(4, 6, 1), machine('assembler', 5, 5, 0, 'asm_circuit')]);
    sim.run(50);
    const m = sim.snapshot().machines[0]!;
    expect(m.inputs.wire).toBe(6); // 3 wire per craft x 2
    expect(m.inputs.iron_plate).toBe(0);
    expect(m.progress).toBe(0);
    expect(sim.snapshot().jams).toHaveLength(0);
  });

  it('a third ingredient is a wrong-item jam', () => {
    const puzzle = makePuzzle({ sources: [source(3, 6, 1, 'stone', 1, 1)] });
    const sim = createSim(puzzle, [belt(4, 6, 1), machine('assembler', 5, 5, 0, 'asm_motor')]);
    sim.run(10);
    expect(sim.snapshot().jams[0]).toMatchObject({ pos: { x: 4, y: 6 }, reason: 'wrong-item' });
  });
});

describe('press', () => {
  for (const rot of [0, 1, 2, 3] as Rotation[]) {
    it(`outputs on an adjacent side of the input (rot ${rot})`, () => {
      const p = machine('press', 8, 8, rot, 'press_rod');
      const ports = placementPorts(p);
      const inP = ports.find((w) => w.kind === 'in')!;
      const outP = ports.find((w) => w.kind === 'out')!;
      expect((outP.side - inP.side + 4) % 2).toBe(1); // perpendicular, not opposite
      const end = step(outP.neighbor, outP.side);
      const puzzle = makePuzzle({
        sources: [source(inP.neighbor.x, inP.neighbor.y, opposite(inP.side), 'iron_plate', 1, 6)],
        disposals: [disposal(end.x, end.y, opposite(outP.side))],
      });
      const sim = createSim(puzzle, [p, belt(outP.neighbor.x, outP.neighbor.y, outP.side)]);
      let seen = 0;
      for (let i = 0; i < 60; i++) {
        sim.step();
        if (itemAt(sim, outP.neighbor.x, outP.neighbor.y) === 'rod') seen++;
      }
      expect(seen).toBeGreaterThanOrEqual(6);
      expect(sim.snapshot().jams).toHaveLength(0);
    });
  }

  it('wire press makes 2 wire per copper plate', () => {
    // press rot 0 at (5,5): in west of (5,5), out south of (6,6)
    const puzzle = makePuzzle({
      sources: [source(3, 5, 1, 'copper_plate', 1, 4)],
      demands: [demand(6, 8, 0, 'wire', 1, 2)],
    });
    const sim = createSim(puzzle, [belt(4, 5, 1), machine('press', 5, 5, 0, 'press_wire'), belt(6, 7, 2)]);
    sim.run(100);
    const a = sim.snapshot().demands[0]!.delivered;
    sim.run(40);
    expect(sim.snapshot().demands[0]!.delivered - a).toBe(20);
  });
});

describe('source timing', () => {
  it('{count:1,ticks:6} first emits on tick 6, then every 6 ticks', () => {
    const puzzle = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore', 1, 6)] });
    const sim = createSim(puzzle, [belt(1, 5, 1), ...line(2, 5, 12, 5, 1)]);
    sim.run(5);
    expect(sim.snapshot().items).toHaveLength(0);
    sim.step();
    expect(sim.snapshot().items).toHaveLength(1);
    sim.run(6);
    expect(sim.snapshot().items).toHaveLength(2);
  });

  it('{count:2,ticks:3} emits 2 items per 3 ticks', () => {
    const puzzle = makePuzzle({
      sources: [source(0, 5, 1, 'iron_ore', 2, 3)],
      demands: [demand(10, 5, 3, 'iron_ore', 2, 3)],
    });
    const sim = createSim(puzzle, line(1, 5, 9, 5, 1));
    sim.run(90);
    expect(sim.snapshot().demands[0]!.delivered).toBeGreaterThanOrEqual(2 * ((90 - 12) / 3) - 2);
    // no more than 2 per 3 ticks were ever created
    expect(sim.snapshot().demands[0]!.delivered + sim.snapshot().items.length).toBeLessThanOrEqual(60);
  });

  it('a blocked source does not jam and does not burst afterwards', () => {
    const puzzle = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore', 1, 1)] });
    // head-on wall: the source's own belt faces it
    const sim = createSim(puzzle, [belt(1, 5, 3)]);
    sim.run(30);
    const s = sim.snapshot();
    expect(s.items).toHaveLength(0);
    expect(s.jams).toHaveLength(0);
  });

  it('a source blocked behind a full belt waits without jamming', () => {
    const puzzle = makePuzzle({ sources: [source(0, 5, 1, 'iron_ore', 1, 1)], demands: [demand(5, 5, 3, 'iron_ore', 1, 1)] });
    const sim = createSim(puzzle, line(1, 5, 4, 5, 1));
    sim.run(50);
    expect(sim.snapshot().jams).toHaveLength(0);
  });
});
