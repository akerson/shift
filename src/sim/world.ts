import { bufferCapacity } from '../shared/catalog';
import type { ItemId, Placement, Puzzle } from '../shared/types';
import type { DemandView, Deadlock, Jam, MachineView, Sim, SimSnapshot } from './api';
import { validateLayout } from './layout';
import { buildTopology, WRONG_ITEM, type Node, type Target } from './topology';

export function createSim(puzzle: Puzzle, placements: readonly Placement[]): Sim {
  const errs = validateLayout(puzzle, placements);
  if (errs.length > 0) {
    throw new Error(`Invalid layout: ${errs.map((e) => `${e.code} (${e.message})`).join('; ')}`);
  }
  const topo = buildTopology(puzzle, placements);
  const { holders, machines, nodes, sources, preds, mergerFeeders } = topo;
  const N = nodes.length;

  let tick = 0;
  let firstDelivery: number | null = null;
  const jams: Jam[] = [];
  const deadlocks: Deadlock[] = [];
  /** Consecutive ticks each machine has been idle, stuck with an item waiting and another ingredient missing. */
  const stuckFor = machines.map(() => 0);
  const stuckSig = machines.map(() => -1);
  const delivered = puzzle.demands.map(() => 0);
  const deliveredWin = puzzle.demands.map(() => 0);

  const moving = new Uint8Array(N);
  /** For splitters: the output index chosen by the last pick(). */
  const choice = new Int8Array(N);

  const itemOf = (n: Node): ItemId | null => {
    if (n.holder) return n.holder.item;
    const m = machines[n.machine]!;
    return (m.outputs[n.emitItem!] ?? 0) > 0 ? n.emitItem : null;
  };

  const resolve = (t: Target, item: ItemId): Target => {
    if (t.k === 'port') return machines[t.m]!.recipe.inputs[item] ? t : WRONG_ITEM;
    if (t.k === 'demand') return puzzle.demands[t.idx]!.item === item ? t : WRONG_ITEM;
    return t;
  };

  /** Free room in the buffer behind an input port, counting earlier ports of the same machine that also deliver. */
  const portRoom = (t: Extract<Target, { k: 'port' }>, item: ItemId): number => {
    const m = machines[t.m]!;
    let room = bufferCapacity(m.recipe, item) - (m.inputs[item] ?? 0);
    for (let i = 0; i < t.port; i++) {
      const f = m.inPorts[i]!.feeder;
      if (f >= 0 && moving[f] && itemOf(nodes[f]!) === item) room--;
    }
    return room;
  };

  /** Would the target take an item this tick, ignoring merger arbitration? */
  const ready = (t: Target, item: ItemId): boolean => {
    switch (t.k) {
      case 'bad':
        return false;
      case 'holder':
        return holders[t.idx]!.item === null || moving[t.idx] === 1;
      case 'port':
        return portRoom(t, item) > 0;
      default:
        return true;
    }
  };

  /** The resolved target this node currently wants to send its item to, or null. */
  const pick = (n: Node): Target | null => {
    const item = itemOf(n);
    if (item === null) return null;
    if (n.kind === 'sorter') {
      const t = resolve(n.targets[n.holder!.filter === item ? 0 : 1]!, item);
      return t.k === 'bad' ? null : t;
    }
    if (n.kind === 'splitter') {
      const ptr = n.holder!.ptr;
      for (let i = 0; i < 3; i++) {
        const c = (ptr + i) % 3;
        const t = resolve(n.targets[c]!, item);
        if (t.k !== 'bad' && ready(t, item)) {
          choice[n.id] = c;
          return t;
        }
      }
      return null;
    }
    const t = resolve(n.targets[0]!, item);
    return t.k === 'bad' ? null : t;
  };

  /** Merger arbitration: the node that gets the merger's slot this tick (round-robin by slot). */
  const winner = (mi: number): number => {
    const ptr = holders[mi]!.ptr;
    let best = -1;
    let bestRank = 4;
    for (const f of mergerFeeders[mi]!) {
      const t = pick(nodes[f.node]!);
      if (!t || t.k !== 'holder' || t.idx !== mi) continue;
      const rank = (f.slot - ptr + 3) % 3;
      if (rank < bestRank) {
        bestRank = rank;
        best = f.node;
      }
    }
    return best;
  };

  const evalMove = (n: Node): boolean => {
    const item = itemOf(n);
    if (item === null) return false;
    const t = pick(n);
    if (!t) return false;
    if (t.k === 'holder') {
      const h = holders[t.idx]!;
      if (!(h.item === null || moving[t.idx] === 1)) return false;
      return h.kind !== 'merger' || winner(t.idx) === n.id;
    }
    return ready(t, item);
  };

  const recordJams = () => {
    for (const n of nodes) {
      const h = n.holder;
      if (!h || h.item === null || h.jamDone || h.kind === 'splitter') continue;
      const raw = resolve(n.targets[h.kind === 'sorter' && h.filter !== h.item ? 1 : 0]!, h.item);
      if (raw.k === 'bad') {
        h.jamDone = true;
        jams.push({ tick, pos: { ...h.pos }, item: h.item, reason: raw.reason });
      }
    }
  };

  const deliver = (t: Target, item: ItemId) => {
    if (t.k === 'port') {
      const m = machines[t.m]!;
      m.inputs[item] = (m.inputs[item] ?? 0) + 1;
    } else if (t.k === 'demand') {
      delivered[t.idx]!++;
      if (tick > puzzle.warmupTicks && tick <= puzzle.warmupTicks + puzzle.windowTicks) deliveredWin[t.idx]!++;
      if (firstDelivery === null) firstDelivery = tick;
    }
  };

  const craft = () => {
    for (const m of machines) {
      const r = m.recipe;
      if (m.crafting) {
        if (m.progress < r.craftTicks) m.progress++;
        if (m.progress === r.craftTicks) {
          const outCap = r.output.count * 2;
          const byCap = r.byproduct ? r.byproduct.count * 2 : 0;
          const okOut = (m.outputs[r.output.item] ?? 0) + r.output.count <= outCap;
          const okBy = !r.byproduct || (m.outputs[r.byproduct.item] ?? 0) + r.byproduct.count <= byCap;
          if (okOut && okBy) {
            m.outputs[r.output.item] = (m.outputs[r.output.item] ?? 0) + r.output.count;
            if (r.byproduct) m.outputs[r.byproduct.item] = (m.outputs[r.byproduct.item] ?? 0) + r.byproduct.count;
            m.crafting = false;
            m.progress = 0;
          }
        }
      }
      if (!m.crafting) {
        let ok = true;
        for (const k of Object.keys(r.inputs)) if ((m.inputs[k] ?? 0) < r.inputs[k]!) ok = false;
        if (ok) {
          for (const k of Object.keys(r.inputs)) m.inputs[k]! -= r.inputs[k]!;
          m.crafting = true;
          m.progress = 0;
        }
      }
    }
  };

  const movement = () => {
    for (const h of holders) h.from = h.pos;
    recordJams();

    // Greatest fixed point: start by assuming every item moves, then withdraw
    // moves that turn out to be blocked. Closed loops of full belts survive.
    const queue: number[] = [];
    for (const n of nodes) {
      const has = itemOf(n) !== null;
      moving[n.id] = has ? 1 : 0;
      if (has) queue.push(n.id);
    }
    const drain = () => {
      while (queue.length > 0) {
        const id = queue.pop()!;
        if (moving[id] === 1 && !evalMove(nodes[id]!)) {
          moving[id] = 0;
          if (id < holders.length) for (const p of preds[id]!) queue.push(p);
          // Arbitration/port-claim neighbours may change their mind too.
          for (const t of nodes[id]!.targets) {
            if (t.k === 'holder' && holders[t.idx]!.kind === 'merger') for (const f of mergerFeeders[t.idx]!) queue.push(f.node);
            if (t.k === 'port') for (const ip of machines[t.m]!.inPorts) if (ip.feeder >= 0) queue.push(ip.feeder);
          }
        }
      }
    };
    drain();
    // Verification: every mover must be valid under the final state.
    let again = true;
    while (again) {
      again = false;
      for (const n of nodes) {
        if (moving[n.id] === 1 && !evalMove(n)) {
          queue.push(n.id);
          again = true;
        }
      }
      drain();
    }

    // Apply. Decide everything first, then remove, then place.
    const moves: { n: Node; t: Target; item: ItemId; c: number }[] = [];
    for (const n of nodes) {
      if (moving[n.id] !== 1) continue;
      const item = itemOf(n)!;
      const t = pick(n)!;
      moves.push({ n, t, item, c: n.kind === 'splitter' ? choice[n.id]! : 0 });
    }
    for (const mv of moves) {
      if (mv.n.holder) mv.n.holder.item = null;
      else machines[mv.n.machine]!.outputs[mv.item]!--;
    }
    for (const mv of moves) {
      const { n, t, item } = mv;
      if (t.k === 'holder') {
        const h = holders[t.idx]!;
        h.item = item;
        h.from = n.pos;
        h.jamDone = false;
        if (h.kind === 'merger') h.ptr = (t.slot + 1) % 3;
      } else deliver(t, item);
      if (n.kind === 'splitter') n.holder!.ptr = (mv.c + 1) % 3;
    }
  };

  const emitSources = () => {
    for (const s of sources) {
      const def = puzzle.sources[s.index]!;
      s.acc = Math.min(s.acc + def.rate.count, def.rate.ticks + def.rate.count - 1);
      if (s.acc < def.rate.ticks) continue;
      const t = resolve(s.target, def.item);
      if (t.k === 'holder') {
        const h = holders[t.idx]!;
        if (h.item !== null) continue;
        h.item = def.item;
        h.from = def.pos;
        h.jamDone = false;
      } else if (t.k === 'port') {
        const m = machines[t.m]!;
        if (bufferCapacity(m.recipe, def.item) - (m.inputs[def.item] ?? 0) <= 0) continue;
        deliver(t, def.item);
      } else if (t.k === 'demand' || t.k === 'disposal') {
        deliver(t, def.item);
      } else continue;
      s.acc -= def.rate.ticks;
    }
  };

  /** Items held at machine mi's input ports because that ingredient's buffer is full. Stable port order, deduplicated. */
  const waitingAt = (mi: number): ItemId[] => {
    const m = machines[mi]!;
    const out: ItemId[] = [];
    const note = (item: ItemId | null, t: Target) => {
      if (item === null || t.k !== 'port' || t.m !== mi || !m.recipe.inputs[item]) return;
      if (bufferCapacity(m.recipe, item) - (m.inputs[item] ?? 0) > 0) return;
      if (!out.includes(item)) out.push(item);
    };
    for (const p of m.inPorts) {
      if (p.feeder >= 0) {
        const n = nodes[p.feeder]!;
        const item = itemOf(n);
        if (item !== null) for (const t of n.targets) note(item, resolve(t, item));
      }
    }
    for (const s of sources) {
      const def = puzzle.sources[s.index]!;
      if (s.acc >= def.rate.ticks) note(def.item, resolve(s.target, def.item));
    }
    return out;
  };

  const missingOf = (mi: number): ItemId[] => {
    const m = machines[mi]!;
    return Object.keys(m.recipe.inputs).filter((k) => (m.inputs[k] ?? 0) < m.recipe.inputs[k]!);
  };

  /** A blocked item is only reported after this many consecutive stuck ticks, so brief backpressure isn't flagged. */
  const DEADLOCK_TICKS = 8;

  const trackDeadlocks = () => {
    machines.forEach((m, mi) => {
      const waiting = waitingAt(mi);
      const missing = missingOf(mi);
      const stuck = !m.crafting && missing.length > 0 && waiting.some((w) => !missing.includes(w));
      let sig = 0;
      for (const k of Object.keys(m.recipe.inputs)) sig = sig * 64 + (m.inputs[k] ?? 0);
      if (!stuck) {
        stuckFor[mi] = 0;
      } else {
        stuckFor[mi] = sig === stuckSig[mi] ? stuckFor[mi]! + 1 : 1;
        if (stuckFor[mi] === DEADLOCK_TICKS) deadlocks.push({ tick, placement: m.placement, waiting, missing });
      }
      stuckSig[mi] = sig;
    });
  };

  const api: Sim = {
    puzzle,
    placements,
    step() {
      tick++;
      craft();
      movement();
      emitSources();
      trackDeadlocks();
    },
    run(n: number) {
      for (let i = 0; i < n; i++) api.step();
    },
    snapshot(): SimSnapshot {
      const items = [];
      for (const h of holders) {
        if (h.item !== null) items.push({ item: h.item, pos: { ...h.pos }, from: { ...h.from } });
      }
      const mviews: MachineView[] = machines.map((m, mi) => ({
        placement: m.placement,
        recipe: m.recipe.id,
        inputs: { ...m.inputs },
        outputs: { ...m.outputs },
        progress: m.progress,
        craftTicks: m.recipe.craftTicks,
        stalled: m.crafting && m.progress === m.recipe.craftTicks,
        waiting: waitingAt(mi),
        missing: missingOf(mi),
        deadlocked: stuckFor[mi]! >= DEADLOCK_TICKS,
      }));
      const dviews: DemandView[] = puzzle.demands.map((_, index) => ({
        index,
        delivered: delivered[index]!,
        deliveredInWindow: deliveredWin[index]!,
      }));
      return {
        tick,
        items,
        machines: mviews,
        demands: dviews,
        jams: jams.map((j) => ({ ...j, pos: { ...j.pos } })),
        deadlocks: deadlocks.map((d) => ({ ...d, waiting: [...d.waiting], missing: [...d.missing] })),
        firstDelivery,
      };
    },
  };
  return api;
}
