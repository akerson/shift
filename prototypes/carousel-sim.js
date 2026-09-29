// Carousel prototype: items, machines, puzzles and the timed simulation.
// Shared by carousel.html and carousel-solver.mjs. Throwaway.

// ============ items (mirrors src/shared/shapes.ts encoding) ============
const COLORS = { R:['Red','#e5484d'], Y:['Yellow','#f5c542'], B:['Blue','#3b82f6'], O:['Orange','#f28c28'], G:['Green','#3fb950'], P:['Purple','#a371f7'], W:['Grey','#aab4c0'] };
const SIDE_NAMES = { 3:'triangle', 4:'square', 5:'pentagon', 6:'hexagon' };
const dec = id => id[0] === 'p' ? { kind:'paint', color:id[1] } : { kind:'shape', sides:+id[1], border:id[2], fill:id[3] };
const enc = it => it.kind === 'paint' ? 'p' + it.color : 's' + it.sides + it.border + it.fill;
function describe(id) {
  const it = dec(id);
  if (it.kind === 'paint') return COLORS[it.color][0] + ' paint';
  const fill = it.fill === '-' ? 'hollow' : COLORS[it.fill][0].toLowerCase() + '-filled';
  return `${COLORS[it.border][0]}-bordered ${fill} ${SIDE_NAMES[it.sides]}`;
}
function mix(a, b) {
  if (a === b) return a;
  if (a === 'W') return b;
  if (b === 'W') return a;
  const k = [a, b].sort().join('');
  return { RY:'O', BY:'G', BR:'P' }[k] || null;
}

// ============ machines ============
const MACH = {
  painter:  { name:'Painter',  short:'PAINT', ins:['shape','paint'], time:4, desc:'shape + paint → border painted' },
  filler:   { name:'Filler',   short:'FILL',  ins:['shape','paint'], time:4, desc:'shape + paint → fill painted' },
  mixer:    { name:'Mixer',    short:'MIX',   ins:['paint','paint'], time:3, desc:'paint + paint → mixed paint' },
  cutter:   { name:'Cutter',   short:'CUT',   ins:['shape'], time:3, desc:'one fewer side' },
  extender: { name:'Extender', short:'EXT',   ins:['shape'], time:3, desc:'one more side' },
  washer:   { name:'Washer',   short:'WASH',  ins:['shape'], time:2, desc:'removes the fill' },
};
// Returns [resultId] or [null, reason].
function process(type, inputs) {
  const its = inputs.map(dec);
  const s = its.find(i => i.kind === 'shape'), p = its.filter(i => i.kind === 'paint');
  switch (type) {
    case 'painter': return [enc({ ...s, border: p[0].color })];
    case 'filler':  return [enc({ ...s, fill: p[0].color })];
    case 'washer':  return [enc({ ...s, fill: '-' })];
    case 'cutter':  return s.sides <= 3 ? [null, "A triangle can't be cut any further."] : [enc({ ...s, sides: s.sides - 1 })];
    case 'extender':return s.sides >= 6 ? [null, "A hexagon can't be extended any further."] : [enc({ ...s, sides: s.sides + 1 })];
    case 'mixer': { const c = mix(p[0].color, p[1].color);
      return c ? ['p' + c] : [null, `${COLORS[p[0].color][0]} and ${COLORS[p[1].color][0].toLowerCase()} don't mix. Only primaries (red, yellow, blue) combine.`]; }
  }
}

// ============ puzzles ============
// 8 slots clockwise from the top. {src:id} | {goal:id} | {block:true} | null (buildable)
const PUZZLES = [
  { id:'c1', name:'1 · First Coat', goal:'s4R-', count:6, parts:['painter'],
    slots:[{src:'s4W-'}, null, null, {src:'pR'}, null, null, {goal:'s4R-'}, null],
    hint:'Paint grey squares red. Where you put the painter decides how far the arm travels.' },
  { id:'c2', name:'2 · Purple Reign', goal:'s4P-', count:6, parts:['painter','mixer'],
    slots:[{src:'s4W-'}, null, {src:'pR'}, null, {src:'pB'}, null, {goal:'s4P-'}, null],
    hint:'There is no purple paint. The mixer is slow, so what can the arm do while it works?' },
  { id:'c3', name:'3 · Trim & Rinse', goal:'s3R-', count:6, parts:['cutter','washer','painter'],
    slots:[{src:'s4WB'}, null, {block:true}, {src:'pR'}, null, {goal:'s3R-'}, null, null],
    hint:'Three machines and four free slots. Does the order of operations matter here?' },
  { id:'c4', name:'4 · Greenhouse', goal:'s5GY', count:4, parts:['cutter','mixer','painter','filler','washer'],
    slots:[{src:'s6WR'}, null, {src:'pY'}, null, {goal:'s5GY'}, null, {src:'pB'}, null],
    hint:'Green border, yellow fill, five sides. Yellow does two jobs. Every free slot counts.' },
];

// ============ simulation (deterministic, integer) ============
// lenient: grabbing nothing / dropping with an empty hand is a no-op (Opus Magnum style) instead of a jam.
// That lets a looping program pipeline: its first pass can harmlessly grab from a machine that isn't primed yet.
const RULES = { lenient: true };
function initSim(pz, build) {
  return {
    pc: 0, arm: 0, held: null, cycle: 0, delivered: 0, jam: null, won: false, stalled: false,
    mach: build.slots.map(t => t ? { type: t, inputs: MACH[t].ins.map(() => null), busy: 0, pending: null, out: null } : null),
  };
}
const slotAt = (arm) => ((arm % 8) + 8) % 8;
function slotName(pz, st, i) {
  const f = pz.slots[i];
  if (f && f.src) return 'the ' + describe(f.src).toLowerCase() + ' source';
  if (f && f.goal) return 'the goal';
  if (f && f.block) return 'a blocked slot';
  if (st.mach[i]) return 'the ' + MACH[st.mach[i].type].name.toLowerCase();
  return 'an empty slot';
}
function step(pz, tape, st) {
  if (st.jam || st.won || tape.length === 0) return;
  const op = tape[st.pc], i = slotAt(st.arm), f = pz.slots[i], m = st.mach[i];
  const jam = (msg) => { st.jam = { msg, slot: i }; };
  let advance = true;
  st.stalled = false; st.idle = false; st.lastPc = st.pc;
  if (op === 'L') st.arm--;
  else if (op === 'R') st.arm++;
  else if (op === 'G') {
    if (st.held) { if (!RULES.lenient) jam("The arm is already holding something. Drop it before grabbing again."); else st.idle = true; }
    else if (f && f.src) st.held = f.src;
    else if (m && m.out) { st.held = m.out; m.out = null; }
    else if (m && m.busy > 0) { advance = false; st.stalled = true; }
    else if (RULES.lenient) st.idle = true; // Opus Magnum style: grabbing nothing is allowed
    else if (m) jam(`The ${MACH[m.type].name.toLowerCase()} has nothing to give. It's still waiting for ${m.inputs.map((x, k) => x ? null : MACH[m.type].ins[k]).filter(Boolean).join(' and ')}.`);
    else jam(`Nothing to grab from ${slotName(pz, st, i)}.`);
  } else if (op === 'D') {
    if (!st.held) { if (!RULES.lenient) jam("The arm isn't holding anything to drop."); else st.idle = true; }
    else if (f && f.goal) {
      if (st.held === f.goal) { st.held = null; st.delivered++; if (st.delivered >= pz.count) st.won = true; }
      else jam(`Wrong shape: the goal wants a ${describe(f.goal).toLowerCase()}, not a ${describe(st.held).toLowerCase()}.`);
    } else if (m) {
      const kind = dec(st.held).kind, def = MACH[m.type];
      if (!def.ins.includes(kind)) jam(`The ${def.name.toLowerCase()} can't use ${kind === 'paint' ? 'paint' : 'a shape'}.`);
      else {
        const k = def.ins.findIndex((want, k) => want === kind && !m.inputs[k]);
        if (k < 0) jam(`The ${def.name.toLowerCase()} already has ${kind === 'paint' ? 'paint' : 'a shape'} waiting.`);
        else { m.inputs[k] = st.held; st.held = null; }
      }
    } else jam(`Can't drop onto ${slotName(pz, st, i)}.`);
  }
  if (advance && !st.jam) st.pc = (st.pc + 1) % tape.length;
  // machines tick in slot order
  if (!st.jam) st.mach.forEach((mm, k) => {
    if (!mm || st.jam) return;
    if (mm.busy > 0) { mm.busy--; if (mm.busy === 0) { mm.out = mm.pending; mm.pending = null; } }
    if (mm.busy === 0 && !mm.out && mm.inputs.every(Boolean)) {
      const [res, why] = process(mm.type, mm.inputs);
      if (!res) { st.jam = { msg: why, slot: k }; return; }
      mm.pending = res; mm.inputs = mm.inputs.map(() => null); mm.busy = MACH[mm.type].time;
    }
  });
  st.cycle++;
  if (!st.won && !st.jam && st.cycle >= 999) st.jam = { msg: 'Out of time (999 cycles).', slot: -1 };
}

export { RULES, COLORS, SIDE_NAMES, dec, enc, describe, mix, MACH, process, PUZZLES, initSim, step, slotAt, slotName };
