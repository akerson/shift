// Carousel solver (throwaway). Finds proven-optimal programs for the prototype puzzles.
//
//   node prototypes/carousel-solver.mjs [puzzleId] [--cycles] [--steady]
//
// Key fact: correctness doesn't depend on timing. A grab on a busy machine just waits,
// and nothing else reads the clock. So a program's success is decided by its sequence of
// *actions* (grab/drop at a slot); rotations only cost steps and cycles. That turns
// "fewest steps" into a shortest closed walk over logical states (Dijkstra), which is tiny.
//
// Instruction models compared:
//   rotate    L / R / GRAB / DROP             (the prototype today)
//   goto      GOTO n / GRAB / DROP            (absolute moves: 1 step each, time = distance)
//   compound  GRAB@n / DROP@n                 (one chip per action)
//
// "Fewest steps" searches loops that return to the start state (empty machines, empty arm,
// arm at slot 0) having delivered >= 1 item. Loops that rely on a primed steady state are
// then tried from every reachable state and kept only if they also run cleanly from the start.

import { PUZZLES, MACH, RULES, process as proc, initSim, step } from './carousel-sim.js';

const NODE_CAP = 1_500_000;
const dist = (a, b) => { const d = (((b - a) % 8) + 8) % 8; return Math.min(d, 8 - d); };
const kindOf = id => (id[0] === 'p' ? 'paint' : 'shape');

// ---------- logical (timing-free) model ----------
const startState = slots => ({ arm: 0, held: null, d: 0, m: slots.map(t => (t ? { in: MACH[t].ins.map(() => null), out: null } : null)) });
const keyOf = s => `${s.arm}|${s.held || ''}|${s.d > 0 ? 1 : 0}|` + s.m.map(x => (x ? x.in.map(v => v || '.').join(',') + '>' + (x.out || '.') : '')).join(';');
const clone = s => ({ arm: s.arm, held: s.held, d: s.d, m: s.m.map(x => (x ? { in: [...x.in], out: x.out } : null)) });

function settle(slots, x, i) {
  // a machine with full inputs and a free output processes (instantly, in logical time)
  if (!x.out && x.in.every(Boolean)) {
    const [res] = proc(slots[i], x.in);
    if (!res) return false;
    x.out = res; x.in = x.in.map(() => null);
  }
  return true;
}
// Items that can still lead to the goal with this placement's machines. There's no disposal,
// so any other item can never leave the ring, and a loop that makes one can't return to start.
const usefulCache = new Map();
function usefulItems(pz, slots) {
  const ck = pz.id + slots.join(',');
  if (usefulCache.has(ck)) return usefulCache.get(ck);
  const types = [...new Set(slots.filter(Boolean))];
  const combos = (F, t) => {
    const ins = MACH[t].ins, pools = ins.map(k => [...F].filter(id => kindOf(id) === k));
    return ins.length === 1 ? pools[0].map(a => [a]) : pools[0].flatMap(a => pools[1].map(b => [a, b]));
  };
  const F = new Set(pz.slots.filter(f => f && f.src).map(f => f.src));
  for (let grew = true; grew;) {
    grew = false;
    for (const t of types) for (const c of combos(F, t)) { const [r] = proc(t, c); if (r && !F.has(r)) { F.add(r); grew = true; } }
  }
  const U = new Set([pz.goal]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of types) for (const c of combos(F, t)) { const [r] = proc(t, c); if (r && U.has(r)) for (const a of c) if (!U.has(a)) { U.add(a); grew = true; } }
  }
  U.producible = F.has(pz.goal);
  usefulCache.set(ck, U);
  return U;
}
function act(pz, slots, s0, op, i) {
  const s = actRaw(pz, slots, s0, op, i);
  if (!s) return null;
  const U = usefulItems(pz, slots);
  if (s.held && !U.has(s.held)) return null;
  for (const x of s.m) if (x && ((x.out && !U.has(x.out)) || x.in.some(v => v && !U.has(v)))) return null;
  return s;
}
function actRaw(pz, slots, s0, op, i) {
  const s = clone(s0), f = pz.slots[i], x = s.m[i];
  s.arm = i;
  if (op === 'G') {
    if (s.held) return RULES.lenient ? s : null;
    if (f && f.src) { s.held = f.src; return s; }
    if (x && x.out) { s.held = x.out; x.out = null; return settle(slots, x, i) ? s : null; }
    return RULES.lenient ? s : null;
  }
  if (!s.held) return RULES.lenient ? s : null;
  if (f && f.goal) { if (s.held !== f.goal) return null; s.held = null; s.d++; return s; }
  if (!x) return null;
  const kind = kindOf(s.held), ins = MACH[slots[i]].ins;
  const k = ins.findIndex((w, k) => w === kind && !x.in[k]);
  if (k < 0) return null;
  x.in[k] = s.held; s.held = null;
  return settle(slots, x, i) ? s : null;
}
const COST = {
  rotate: (from, to) => dist(from, to) + 1,
  goto: (from, to) => (from === to ? 0 : 1) + 1,
  compound: () => 1,
};
const CLOSE = { rotate: a => dist(a, 0), goto: a => (a === 0 ? 0 : 1), compound: () => 0 };

// Shortest closed walk from `start` back to a state equal to it (ignoring delivery count) with >= 1 delivery.
function shortestLoop(pz, slots, start, model, limit = Infinity) {
  const targetKey = keyOf({ ...start, d: 1 });
  // nodes: [state, parentIndex, action]; paths are rebuilt from parents to keep memory flat
  const nodes = [[start, -1, null]], buckets = [[0]], seen = new Map([[keyOf(start), 0]]);
  const pathOf = n => { const p = []; for (; nodes[n][1] >= 0; n = nodes[n][1]) p.push(nodes[n][2]); return p.reverse(); };
  let best = null;
  for (let c = 0; c < buckets.length && c <= limit; c++) {
    for (const idx of buckets[c] || []) {
      const s = nodes[idx][0];
      if (seen.get(keyOf(s)) < c) continue;
      if (best && c >= best.cost) return best;
      if (nodes.length > NODE_CAP) return best ? best : { capped: true };
      // try to close the loop: arm returns to the start's arm position
      if (s.d > 0) {
        const cl = { ...s, arm: start.arm };
        if (keyOf(cl) === targetKey) {
          const cost = c + CLOSE[model](s.arm);
          if (!best || cost < best.cost) best = { cost, path: pathOf(idx) };
        }
      }
      for (let i = 0; i < 8; i++) for (const op of ['G', 'D']) {
        const n = act(pz, slots, s, op, i);
        if (!n) continue;
        const nc = c + COST[model](s.arm, i), k = keyOf(n);
        if (nc > limit || (seen.has(k) && seen.get(k) <= nc)) continue;
        seen.set(k, nc);
        nodes.push([n, idx, op + i]);
        (buckets[nc] ||= []).push(nodes.length - 1);
      }
    }
  }
  return best;
}

// All logical states reachable from start (for steady-state loops).
function reachable(pz, slots, start, cap = 20000) {
  const seen = new Map([[keyOf(start), start]]), q = [start];
  while (q.length && seen.size < cap) {
    const s = q.shift();
    for (let i = 0; i < 8; i++) for (const op of ['G', 'D']) {
      const n = act(pz, slots, s, op, i);
      if (!n) continue;
      n.d = 0;
      const k = keyOf(n);
      if (!seen.has(k)) { seen.set(k, n); q.push(n); }
    }
  }
  return [...seen.values()];
}

// Turn an action path (from arm 0) into an L/R/G/D tape.
function toTape(path) {
  const tape = []; let arm = 0;
  const rot = to => { let d = (((to - arm) % 8) + 8) % 8; if (d <= 4) tape.push(...'R'.repeat(d)); else tape.push(...'L'.repeat(8 - d)); arm = to; };
  for (const a of path) { rot(+a[1]); tape.push(a[0]); }
  rot(0);
  return tape;
}
function runTape(pz, slots, tape) {
  const st = initSim(pz, { slots });
  while (!st.won && !st.jam) step(pz, tape, st);
  return st.won ? st.cycle : null;
}

function* placements(pz) {
  const free = pz.slots.map((f, i) => (f ? -1 : i)).filter(i => i >= 0);
  const opts = [null, ...pz.parts];
  const n = opts.length ** free.length;
  for (let k = 0; k < n; k++) {
    const slots = Array(8).fill(null); let r = k;
    for (const i of free) { slots[i] = opts[r % opts.length]; r = Math.floor(r / opts.length); }
    yield slots;
  }
}
const fmtPlace = slots => slots.map((t, i) => (t ? `${i}:${t}` : null)).filter(Boolean).join(' ');
const fmtPath = p => p.map(a => (a[0] === 'G' ? 'G' : 'D') + '@' + a[1]).join(' ');

// ---------- min cycles: BFS over timed states (a straight-line program; no loop needed) ----------
function minCycles(pz, slots, cap = 4_000_000) {
  const st0 = initSim(pz, { slots });
  const k = st => `${st.arm & 7}|${st.held || ''}|${st.delivered}|` + st.mach.map(m => (m ? m.inputs.join(',') + m.busy + (m.pending || '') + (m.out || '') : '')).join(';');
  const cl = st => ({ ...st, jam: null, mach: st.mach.map(m => (m ? { ...m, inputs: [...m.inputs] } : null)) });
  let frontier = [st0]; const seen = new Set([k(st0)]);
  for (let c = 0; c < 400 && frontier.length; c++) {
    const next = [];
    for (const s of frontier) for (const op of 'LRGD') {
      const n = cl(s); n.pc = 0;
      step(pz, [op], n);
      if (n.jam) continue;
      if (n.won) return c + 1;
      const kk = k(n);
      if (!seen.has(kk)) { seen.add(kk); next.push(n); }
    }
    if (seen.size > cap) return `>${c} (state cap)`;
    frontier = next;
  }
  return null;
}

// ---------- Pareto front: every start-returning loop up to maxCost rotate-steps, timed ----------
function paretoFront(pz, maxCost, visitCap = 400_000) {
  const front = { rotate: new Map(), compound: new Map() }; // steps -> {cycles, tape, slots}
  let visits = 0, loopsSeen = 0, capped = false;
  for (const slots of placements(pz)) {
    if (!usefulItems(pz, slots).producible) continue;
    const start = startState(slots);
    const path = [];
    if (visits > visitCap) capped = true;
    visits = 0;
    // Any action sequence is a candidate program (it loops). Check it logically first, cheaply:
    // repeat the passes until the goal count is met, a jam, or a pass that delivers nothing.
    const loopsLogically = () => {
      let s = start;
      for (let pass = 0; pass < pz.count + 3; pass++) {
        const before = s.d;
        for (const a of path) { s = act(pz, slots, s, a[0], +a[1]); if (!s) return false; if (s.d >= pz.count) return true; }
        if (s.d === before && pass > 0) return false;
      }
      return false;
    };
    const dfs = (s, cost) => {
      if (++visits > visitCap) return;
      // Programs strictly alternate GRAB, DROP (two grabs in a row can only waste a step), grabs
      // only target sources and machines, and drops only target machines and the goal.
      const op = path.length % 2 === 0 ? 'G' : 'D';
      for (let i = 0; i < 8; i++) {
        const f = pz.slots[i];
        if (op === 'G' ? !((f && f.src) || slots[i]) : !((f && f.goal) || slots[i])) continue;
        const nc = cost + dist(s.arm, i) + 1;
        if (nc + dist(i, 0) > maxCost) continue;
        const n = act(pz, slots, s, op, i);
        if (!n) continue;
        path.push(op + i);
        if (path.length % 2 === 0 && loopsLogically()) {
          loopsSeen++;
          const tape = toTape(path), cyc = runTape(pz, slots, tape);
          if (cyc !== null) for (const [model, steps] of [['rotate', tape.length], ['compound', path.length]]) {
            const cur = front[model].get(steps);
            if (!cur || cyc < cur.cycles) front[model].set(steps, { cycles: cyc, tape: tape.join(''), path: fmtPath(path), slots: fmtPlace(slots) });
          }
        }
        dfs(n, nc);
        path.pop();
      }
    };
    dfs(start, 0);
  }
  const prune = m => { let bestC = Infinity; return [...m.entries()].sort((a, b) => a[0] - b[0]).filter(([, v]) => (v.cycles < bestC ? ((bestC = v.cycles), true) : false)); };
  return { rotate: prune(front.rotate), compound: prune(front.compound), visits, loopsSeen, capped: capped || visits > visitCap };
}

// ---------- main ----------
export { shortestLoop, startState, usefulItems, placements, act, keyOf, toTape, runTape, minCycles };
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
function main() {
if (process.argv.includes('--strict')) RULES.lenient = false;
const want = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const doCycles = process.argv.includes('--cycles');

const paretoArg = process.argv.find(a => a.startsWith('--pareto'));
if (paretoArg) {
  const maxCost = +(paretoArg.split('=')[1] || 32);
  for (const pz of PUZZLES.filter(p => !want || p.id === want)) {
    const t0 = Date.now(), r = paretoFront(pz, maxCost);
    console.log(`\n=== ${pz.name}: steps vs cycles, loops up to ${maxCost} rotate-steps (${r.loopsSeen} loops, ${Date.now() - t0} ms${r.capped ? ', CAPPED' : ''}) ===`);
    for (const model of ['rotate', 'compound']) {
      console.log(` ${model}:`);
      for (const [steps, v] of r[model]) console.log(`   ${String(steps).padStart(3)} steps → ${v.cycles} cycles  [${v.slots}]  ${model === 'rotate' ? v.tape : v.path}`);
    }
  }
  return;
}
for (const pz of PUZZLES.filter(p => !want || p.id === want)) {
  console.log(`\n=== ${pz.name} (${pz.count} × ${pz.goal}) ===`);
  const t0 = Date.now();
  for (const model of ['rotate', 'goto', 'compound']) {
    let best = null, capped = 0;
    for (const slots of placements(pz)) {
      if (!usefulItems(pz, slots).producible) continue;
      const r = shortestLoop(pz, slots, startState(slots), model, best ? best.cost : Infinity);
      if (r && r.capped) { capped++; continue; }
      if (r && (!best || r.cost < best.cost)) best = { ...r, slots };
    }
    if (capped) console.log(`${model.padEnd(8)} (${capped} placements hit the search cap; result may not be optimal)`);
    if (!best) { console.log(`${model.padEnd(8)} no solution`); continue; }
    const perItem = best.path.filter(a => a[0] === 'D' && pz.slots[+a[1]] && pz.slots[+a[1]].goal).length;
    let line = `${model.padEnd(8)} ${String(best.cost).padStart(3)} steps  [${fmtPlace(best.slots)}]  ${fmtPath(best.path)}  (${perItem}/loop)`;
    if (model === 'rotate') {
      const tape = toTape(best.path);
      const cyc = runTape(pz, best.slots, tape);
      line += `\n         tape ${tape.join('')} → ${cyc === null ? 'FAILS in timed sim' : cyc + ' cycles'}`;
      // steady-state loops: start from any reachable state, must still run from the real start
      let ss = null;
      if (process.argv.includes('--steady')) for (const s of reachable(pz, best.slots, startState(best.slots))) {
        if (s.arm !== 0) continue;
        const r = shortestLoop(pz, best.slots, s, model, best.cost - 1);
        if (!r) continue;
        const t = toTape(r.path), cy = runTape(pz, best.slots, t);
        if (cy !== null && r.cost < best.cost && (!ss || r.cost < ss.cost)) ss = { cost: r.cost, tape: t.join(''), cy };
      }
      if (ss) line += `\n         steady-state loop beats it: ${ss.cost} steps ${ss.tape} → ${ss.cy} cycles`;
      if (doCycles) line += `\n         min cycles (any program, this placement): ${minCycles(pz, best.slots)}`;
    }
    console.log(line);
  }
  console.log(`(${Date.now() - t0} ms)`);
}
}
