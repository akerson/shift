// Static structure of a build: which tile holds what, and where every output points.
// Built once per sim; shared by layout validation (feeder counting) and the world.

import { RECIPES, isMachine } from '../shared/catalog';
import { opposite, placementPorts, placementTiles, step } from '../shared/geometry';
import type { Dir, ItemId, LogisticsType, Placement, Puzzle, Recipe, Vec } from '../shared/types';
import type { JamReason } from './api';

export type Target =
  | { k: 'bad'; reason: JamReason }
  | { k: 'holder'; idx: number; slot: number }
  | { k: 'port'; m: number; port: number }
  | { k: 'demand'; idx: number }
  | { k: 'disposal' };

export const WRONG_ITEM: Target = { k: 'bad', reason: 'wrong-item' };
const DEAD_END: Target = { k: 'bad', reason: 'dead-end' };
const REJECTED: Target = { k: 'bad', reason: 'rejected' };

export interface HolderRT {
  idx: number;
  kind: LogisticsType;
  placement: number;
  /** Tile the item sits on (a sorter's in tile). */
  pos: Vec;
  /** Facing for 1x1 parts. */
  dir: Dir;
  filter?: ItemId;
  item: ItemId | null;
  from: Vec;
  jamDone: boolean;
  /** Round-robin pointer (merger: next slot to favour; splitter: next output index). */
  ptr: number;
}

export interface MachineRT {
  placement: number;
  recipe: Recipe;
  inputs: Record<ItemId, number>;
  outputs: Record<ItemId, number>;
  progress: number;
  crafting: boolean;
  /** Input ports; feeder is the node id whose target is this port (or -1). */
  inPorts: { tile: Vec; side: Dir; feeder: number }[];
}

export type NodeKind = LogisticsType | 'emit';

export interface Node {
  id: number;
  kind: NodeKind;
  holder: HolderRT | null;
  /** Emitters: machine index and the item this port pushes. */
  machine: number;
  emitItem: ItemId | null;
  /** Tile an emitted item starts from. */
  pos: Vec;
  /** belt/merger/emit: [front]; sorter: [out, reject]; splitter: [front, right, left]. */
  targets: Target[];
}

export interface SourceRT {
  index: number;
  target: Target;
  acc: number;
}

const T_EMPTY = 0;
const T_TERRAIN = 1;
const T_SOURCE = 2;
const T_DEMAND = 3;
const T_DISPOSAL = 4;
const T_HOLDER = 5;
const T_MACHINE = 6;
const T_SORTER_AUX = 7;

export interface Topology {
  puzzle: Puzzle;
  holders: HolderRT[];
  machines: MachineRT[];
  nodes: Node[];
  sources: SourceRT[];
  /** preds[holderIdx] = node ids that have a target on that holder. */
  preds: number[][];
  /** mergerFeeders[holderIdx] = feeding node ids with the merger slot they enter by. */
  mergerFeeders: { node: number; slot: number }[][];
}

export function buildTopology(puzzle: Puzzle, placements: readonly Placement[]): Topology {
  const W = puzzle.width;
  const H = puzzle.height;
  const kind = new Uint8Array(W * H).fill(T_EMPTY);
  const ref = new Int32Array(W * H).fill(-1);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const mark = (p: Vec, k: number, r: number) => {
    if (inb(p.x, p.y)) {
      kind[p.y * W + p.x] = k;
      ref[p.y * W + p.x] = r;
    }
  };
  for (const t of puzzle.terrain) mark(t, T_TERRAIN, -1);
  puzzle.sources.forEach((s, i) => mark(s.pos, T_SOURCE, i));
  puzzle.demands.forEach((d, i) => mark(d.pos, T_DEMAND, i));
  puzzle.disposals.forEach((d, i) => mark(d.pos, T_DISPOSAL, i));

  const holders: HolderRT[] = [];
  const machines: MachineRT[] = [];

  placements.forEach((p, pi) => {
    if (isMachine(p.type)) {
      const recipe = RECIPES[p.recipe!]!;
      const mi = machines.length;
      const inputs: Record<ItemId, number> = {};
      for (const k of Object.keys(recipe.inputs)) inputs[k] = 0;
      const outputs: Record<ItemId, number> = { [recipe.output.item]: 0 };
      if (recipe.byproduct) outputs[recipe.byproduct.item] = 0;
      machines.push({
        placement: pi,
        recipe,
        inputs,
        outputs,
        progress: 0,
        crafting: false,
        inPorts: placementPorts(p)
          .filter((w) => w.kind === 'in')
          .map((w) => ({ tile: w.tile, side: w.side, feeder: -1 })),
      });
      for (const t of placementTiles(p)) mark(t, T_MACHINE, mi);
    } else if (p.type === 'sorter') {
      const ports = placementPorts(p);
      const inPort = ports.find((w) => w.kind === 'in')!;
      const outPort = ports.find((w) => w.kind === 'out')!;
      const hi = holders.length;
      holders.push({
        idx: hi,
        kind: 'sorter',
        placement: pi,
        pos: inPort.tile,
        dir: outPort.side,
        filter: p.filter,
        item: null,
        from: inPort.tile,
        jamDone: false,
        ptr: 0,
      });
      for (const t of placementTiles(p)) mark(t, T_SORTER_AUX, hi);
      mark(inPort.tile, T_HOLDER, hi);
    } else {
      const hi = holders.length;
      holders.push({
        idx: hi,
        kind: p.type as LogisticsType,
        placement: pi,
        pos: { ...p.pos },
        dir: p.rot as Dir,
        item: null,
        from: { ...p.pos },
        jamDone: false,
        ptr: 0,
      });
      mark(p.pos, T_HOLDER, hi);
    }
  });

  const classify = (x: number, y: number, d: Dir): Target => {
    if (!inb(x, y)) return DEAD_END;
    const k = kind[y * W + x]!;
    const r = ref[y * W + x]!;
    switch (k) {
      case T_HOLDER: {
        const h = holders[r]!;
        if (h.kind === 'belt' || h.kind === 'merger') {
          if (d === opposite(h.dir)) return REJECTED;
          const slot = ((opposite(d) - h.dir + 4) % 4) - 1;
          return { k: 'holder', idx: r, slot };
        }
        if (h.kind === 'splitter') return d === h.dir ? { k: 'holder', idx: r, slot: 0 } : REJECTED;
        const inPort = placementPorts(placements[h.placement]!).find((w) => w.kind === 'in')!;
        return d === opposite(inPort.side) ? { k: 'holder', idx: r, slot: 0 } : REJECTED;
      }
      case T_SORTER_AUX:
        return REJECTED;
      case T_MACHINE: {
        const m = machines[r]!;
        for (let i = 0; i < m.inPorts.length; i++) {
          const ip = m.inPorts[i]!;
          if (ip.tile.x === x && ip.tile.y === y && ip.side === opposite(d)) return { k: 'port', m: r, port: i };
        }
        return DEAD_END;
      }
      case T_DEMAND:
        return d === opposite(puzzle.demands[r]!.dir) ? { k: 'demand', idx: r } : REJECTED;
      case T_DISPOSAL:
        return d === opposite(puzzle.disposals[r]!.dir) ? { k: 'disposal' } : REJECTED;
      default:
        return DEAD_END; // empty floor, terrain, source
    }
  };
  const toward = (p: Vec, d: Dir): Target => {
    const q = step(p, d);
    return classify(q.x, q.y, d);
  };

  const nodes: Node[] = [];
  for (const h of holders) {
    let targets: Target[];
    if (h.kind === 'sorter') {
      const ports = placementPorts(placements[h.placement]!);
      const out = ports.find((w) => w.kind === 'out')!;
      const rej = ports.find((w) => w.kind === 'reject')!;
      targets = [toward(out.tile, out.side), toward(rej.tile, rej.side)];
    } else if (h.kind === 'splitter') {
      targets = [h.dir, ((h.dir + 1) % 4) as Dir, ((h.dir + 3) % 4) as Dir].map((d) => toward(h.pos, d));
    } else {
      targets = [toward(h.pos, h.dir)];
    }
    nodes.push({ id: h.idx, kind: h.kind, holder: h, machine: -1, emitItem: null, pos: h.pos, targets });
  }
  machines.forEach((m, mi) => {
    for (const w of placementPorts(placements[m.placement]!)) {
      if (w.kind !== 'out' && w.kind !== 'byproduct') continue;
      const item = w.kind === 'out' ? m.recipe.output.item : m.recipe.byproduct?.item;
      if (!item) continue;
      const id = nodes.length;
      nodes.push({ id, kind: 'emit', holder: null, machine: mi, emitItem: item, pos: w.tile, targets: [toward(w.tile, w.side)] });
    }
  });

  const preds: number[][] = holders.map(() => []);
  const mergerFeeders: { node: number; slot: number }[][] = holders.map(() => []);
  for (const n of nodes) {
    for (const t of n.targets) {
      if (t.k === 'holder') {
        preds[t.idx]!.push(n.id);
        if (holders[t.idx]!.kind === 'merger') mergerFeeders[t.idx]!.push({ node: n.id, slot: t.slot });
      } else if (t.k === 'port') {
        machines[t.m]!.inPorts[t.port]!.feeder = n.id;
      }
    }
  }
  const sources: SourceRT[] = puzzle.sources.map((s, index) => ({ index, target: toward(s.pos, s.dir), acc: 0 }));

  return { puzzle, holders, machines, nodes, sources, preds, mergerFeeders };
}
