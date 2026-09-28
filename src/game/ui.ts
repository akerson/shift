// DOM UI: palette, pickers, run controls, status and evaluation results.

import { ITEMS, PARTS, RECIPES, isMachine } from '../shared/catalog';
import { fCmp, fracDecimal, formatRate, planPuzzle, type Frac, type PlanNode } from '../shared/planner';
import type { PartType, Recipe, Rotation, Vec } from '../shared/types';
import { requiredDeliveries } from '../shared/puzzle';
import { HANDMADE } from './puzzleList';
import type { EvalResult } from '../sim/api';
import { engine } from './engine';
import type { Session } from './session';
import { partLabel, placementAt, recipesFor } from './state';
import { drawPortDiagram } from './portDiagram';
import { deadlockReason, deadlockTooltip, machineLabel } from './deadlock';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export interface UI {
  canvas: HTMLCanvasElement;
  canvasWrap: HTMLElement;
  refresh(): void;
  /** Item hovered in the Recipes panel (for the floor highlight), or null. */
  highlightItem(): string | null;
  /** Show/hide the machine recipe tooltip for the hovered tile; anchor is in canvasWrap CSS px. */
  updateTooltip(hover: Vec | null, anchor: { x: number; y: number }): void;
}

const iname = (i: string): string => ITEMS[i]?.name ?? i;
const swatch = (i: string): string => `<span class="sw" style="background:${ITEMS[i]?.color ?? '#888'}"></span>`;

/** "1 Circuit + 1 Plastic → 1 Chip" */
function recipeLine(r: Recipe): string {
  const ins = Object.entries(r.inputs).map(([i, n]) => `${n} ${iname(i)}`).join(' + ');
  const outs = [`${r.output.count} ${iname(r.output.item)}`];
  if (r.byproduct) outs.push(`${r.byproduct.count} ${iname(r.byproduct.item)} (byproduct)`);
  return `${ins} → ${outs.join(' + ')}`;
}

/** "×2 (1.5)": ceil machines, exact count in brackets when fractional. */
function badge(machines: Frac, ceil: number): string {
  return machines.d === 1 ? `×${ceil}` : `×${ceil} (${fracDecimal(machines)})`;
}

export function buildUI(root: HTMLElement, s: Session, now: () => number): UI {
  const puzzle = s.puzzle;
  root.innerHTML = '';
  const shell = el('div', 'shell');
  root.appendChild(shell);

  // ----- header -----
  const header = el('header', 'top');
  header.appendChild(el('h1', '', 'Shift'));
  header.appendChild(
    el('span', 'puzzle-title', `${puzzle.title ?? puzzle.id}${puzzle.number ? ` #${puzzle.number}` : ''}`),
  );
  const puzzlePicker = el('select', 'puzzle-picker');
  puzzlePicker.title = 'Choose puzzle';
  for (const h of HANDMADE) {
    const opt = el('option', '', h.title);
    opt.value = h.id;
    opt.selected = h.id === puzzle.id;
    puzzlePicker.appendChild(opt);
  }
  puzzlePicker.addEventListener('change', () => {
    location.search = `?puzzle=${encodeURIComponent(puzzlePicker.value)}`;
  });
  header.appendChild(puzzlePicker);
  shell.appendChild(header);

  // ----- left: palette -----
  const left = el('aside', 'panel left');
  const tabs = el('div', 'tabs');
  const tabParts = el('button', 'active', 'Parts');
  const tabRecipes = el('button', '', 'Recipes');
  for (const b of [tabParts, tabRecipes]) b.type = 'button';
  tabs.append(tabParts, tabRecipes);
  left.appendChild(tabs);
  const partsView = el('div', 'view');
  const recipesView = el('div', 'view recipes');
  recipesView.style.display = 'none';
  left.append(partsView, recipesView);
  let hoverItem: string | null = null;
  const showTab = (recipes: boolean) => {
    tabParts.classList.toggle('active', !recipes);
    tabRecipes.classList.toggle('active', recipes);
    partsView.style.display = recipes ? 'none' : '';
    recipesView.style.display = recipes ? '' : 'none';
    shell.classList.toggle('wide', recipes);
    hoverItem = null;
  };
  tabParts.addEventListener('click', () => showTab(false));
  tabRecipes.addEventListener('click', () => showTab(true));
  partsView.appendChild(el('h2', '', 'Parts'));
  const palette = el('div', 'palette');
  partsView.appendChild(palette);

  const toolButtons: { btn: HTMLButtonElement; match: () => boolean }[] = [];
  const addTool = (label: string, hint: string, swatch: string, onClick: () => void, match: () => boolean) => {
    const b = el('button', 'tool');
    b.type = 'button';
    b.innerHTML = `<span class="sw" style="background:${swatch}"></span><span class="lbl">${esc(label)}</span><kbd>${esc(hint)}</kbd>`;
    b.addEventListener('click', onClick);
    palette.appendChild(b);
    toolButtons.push({ btn: b, match });
  };
  addTool('Select', 'Q', '#ffd24d', () => s.setTool({ kind: 'select' }), () => s.tool.kind === 'select');
  addTool('Erase', 'E', '#ef6161', () => s.setTool({ kind: 'erase' }), () => s.tool.kind === 'erase');
  const swatches: Record<string, string> = {
    belt: '#6f7d8f', merger: '#a58cf0', splitter: '#5fd6c8', sorter: '#d6c25f',
    smelter: '#6b8199', press: '#6b8199', assembler: '#6b8199', refinery: '#6b8199',
  };
  if (puzzle.parts.includes('belt')) {
    addTool('Belt', 'B', swatches.belt!, () => s.setTool({ kind: 'belt' }), () => s.tool.kind === 'belt');
  }
  puzzle.parts
    .filter((p) => p !== 'belt')
    .forEach((p, i) => {
      const d = PARTS[p];
      addTool(
        `${partLabel(p)} ${d.w}x${d.h}`,
        String(i + 1),
        swatches[p] ?? '#888',
        () => s.setTool({ kind: 'part', part: p }),
        () => s.tool.kind === 'part' && s.tool.part === p,
      );
    });

  const picker = el('div', 'picker');
  const pickerLabel = el('label', '', '');
  const recipeSel = el('select');
  const filterSel = el('select');
  picker.append(pickerLabel, recipeSel, filterSel);
  partsView.appendChild(picker);
  const diagramBox = el('div', 'diagram');
  const diagramCanvas = el('canvas');
  const diagramCap = el('div', 'dim');
  diagramBox.append(diagramCanvas, diagramCap);
  partsView.appendChild(diagramBox);
  recipeSel.addEventListener('change', () => {
    const t = pickerMachine();
    if (t) s.setRecipe(t, recipeSel.value);
  });
  filterSel.addEventListener('change', () => s.setFilter(filterSel.value));

  const editRow = el('div', 'row');
  const undoBtn = el('button', '', 'Undo');
  const redoBtn = el('button', '', 'Redo');
  const clearBtn = el('button', '', 'Clear');
  for (const b of [undoBtn, redoBtn, clearBtn]) b.type = 'button';
  undoBtn.addEventListener('click', () => s.undo());
  redoBtn.addEventListener('click', () => s.redo());
  clearBtn.addEventListener('click', () => s.clearAll());
  editRow.append(undoBtn, redoBtn, clearBtn);
  partsView.appendChild(editRow);

  const help = el('div', 'help');
  help.innerHTML = `
    <b>Controls</b>
    <ul>
      <li>Belt tool: drag to paint; path sets direction</li>
      <li><kbd>R</kbd> rotate ghost / hovered part</li>
      <li>Right-click or <kbd>E</kbd>: erase</li>
      <li>Select: click or drag a box, then drag to move; <kbd>Del</kbd> removes</li>
      <li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> undo / redo</li>
      <li><kbd>Space</kbd> run/pause, <kbd>.</kbd> step</li>
    </ul>
    <b>Ports</b>
    <div class="legend">
      <span style="color:#5ad17a">in</span>
      <span style="color:#5aa9f0">out</span>
      <span style="color:#f0a94a">byproduct</span>
      <span style="color:#ef6161">reject</span>
    </div>`;
  partsView.appendChild(help);

  // ----- centre: canvas -----
  const canvasWrap = el('main', 'canvas-wrap');
  const canvas = el('canvas', 'floor');
  canvasWrap.appendChild(canvas);
  const banner = el('div', 'banner');
  canvasWrap.appendChild(banner);

  // ----- right: run controls and results -----
  const right = el('aside', 'panel right');
  right.appendChild(el('h2', '', 'Simulation'));
  const runRow = el('div', 'row');
  const runBtn = el('button', 'primary', 'Run');
  const stepBtn = el('button', '', 'Step');
  const resetBtn = el('button', '', 'Reset');
  for (const b of [runBtn, stepBtn, resetBtn]) b.type = 'button';
  runBtn.addEventListener('click', () => s.toggleRun(now()));
  stepBtn.addEventListener('click', () => s.stepOnce(now()));
  resetBtn.addEventListener('click', () => s.reset());
  runRow.append(runBtn, stepBtn, resetBtn);
  right.appendChild(runRow);

  const speedRow = el('div', 'row speed');
  const speed = el('input');
  speed.type = 'range';
  speed.min = '1';
  speed.max = '60';
  speed.value = String(s.tps);
  const speedLbl = el('span', '', '');
  speed.addEventListener('input', () => {
    s.tps = Number(speed.value);
    speedLbl.textContent = `${s.tps} ticks/s`;
  });
  speedLbl.textContent = `${s.tps} ticks/s`;
  speedRow.append(el('span', '', 'Speed'), speed, speedLbl);
  right.appendChild(speedRow);

  const status = el('div', 'status');
  right.appendChild(status);
  const deadlockBox = el('div', 'deadlocks');
  right.appendChild(deadlockBox);
  deadlockBox.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-placement]');
    if (b) s.focusPlacement(Number(b.dataset.placement), now());
  });
  const demandBox = el('div', 'demands');
  right.appendChild(demandBox);
  const errorBox = el('div', 'errors');
  right.appendChild(errorBox);

  right.appendChild(el('h2', '', 'Evaluate'));
  const evalBtn = el('button', 'primary', 'Evaluate build');
  evalBtn.type = 'button';
  right.appendChild(evalBtn);
  const resultBox = el('div', 'results');
  right.appendChild(resultBox);
  let lastEval: EvalResult | null = null;
  let lastEvalPlacements: typeof s.placements = s.placements;
  let evalStale = false;

  evalBtn.addEventListener('click', () => {
    try {
      lastEval = engine.evaluate(puzzle, s.placements);
      lastEvalPlacements = s.placements;
    } catch (e) {
      lastEval = null;
      resultBox.innerHTML = `<div class="bad">Evaluation failed: ${esc(String(e))}</div>`;
      return;
    }
    evalStale = false;
    renderResult();
  });

  const fmtPar = (v: number | null, par: number | undefined): string => {
    if (v === null) return '<b>none</b>' + (par !== undefined ? ` <span class="dim">(par ${par})</span>` : '');
    if (par === undefined) return `<b>${v}</b>`;
    const cls = v <= par ? 'ok' : 'warn';
    return `<b class="${cls}">${v}</b> <span class="dim">(par ${par})</span>`;
  };

  function renderResult(): void {
    const r = lastEval;
    if (!r) return;
    const par = puzzle.par;
    let h = `<div class="verdict ${r.pass ? 'ok' : 'bad'}">${r.pass ? 'PASS' : 'FAIL'}${evalStale ? ' <span class="dim">(build changed since)</span>' : ''}</div>`;
    h += '<table>';
    for (const d of r.demands) {
      const dm = puzzle.demands[d.index];
      const name = dm ? (ITEMS[dm.item]?.name ?? dm.item) : `#${d.index}`;
      h += `<tr><td>${esc(name)}</td><td class="${d.met ? 'ok' : 'bad'}">${d.delivered} / ${d.required}</td><td>${d.met ? 'met' : 'short'}</td></tr>`;
    }
    h += '</table>';
    h += `<table class="scores">
      <tr><td>Footprint</td><td>${fmtPar(r.scores.footprint, par?.footprint)}</td></tr>
      <tr><td>Cost</td><td>${fmtPar(r.scores.cost, par?.cost)}</td></tr>
      <tr><td>Latency</td><td>${fmtPar(r.scores.latency, par?.latency)}</td></tr>
    </table>`;
    if (r.layoutErrors.length) h += `<div class="bad">${r.layoutErrors.length} layout error(s)</div>`;
    if (r.jams.length) {
      const first = r.jams[0]!;
      h += `<div class="bad">${r.jams.length} jam(s); first at (${first.pos.x},${first.pos.y}) tick ${first.tick}: ${first.reason}</div>`;
    }
    if (!r.pass && r.deadlocks.length) {
      h += '<div class="deadlock-list"><b>Likely cause: deadlock</b>';
      for (const d of r.deadlocks) {
        h += `<div class="deadlock-line">Deadlock at tick ${d.tick}: ${esc(machineLabel(lastEvalPlacements[d.placement]))} <span class="dim">- ${esc(deadlockReason(d))}</span></div>`;
      }
      h += '</div>';
    }
    resultBox.innerHTML = h;
  }

  // ----- recipes panel (static per puzzle) -----
  const plan = planPuzzle(puzzle);
  const rawInfo = new Map(plan.raw.map((r) => [r.item, r]));
  const nodeHtml = (n: PlanNode, depth: number): string => {
    const ml = `style="margin-left:${depth * 10}px"`;
    let h = `<div class="rrow" data-item="${n.item}" ${ml}><div class="rhead">${swatch(n.item)}<b>${esc(iname(n.item))}</b>`;
    if (n.raw) {
      const bad = n.unavailable || rawInfo.get(n.item)?.ok === false;
      h += `<span class="badge ${bad ? 'bad' : ''}">${n.unavailable ? 'no recipe' : 'raw'}</span></div>
        <div class="rline dim">${formatRate(n.rate)}</div></div>`;
    } else {
      h += `<span class="badge">${badge(n.machines, n.machinesCeil)}</span></div>
        <div class="rline dim">${esc(partLabel(n.machine!))} · ${n.craftTicks}t · ${formatRate(n.rate)}</div>
        <div class="rline">${esc(recipeLine(RECIPES[n.recipe!]!))}</div></div>`;
    }
    if (n.byproduct) {
      h += `<div class="rrow byp" data-item="${n.byproduct.item}" ${ml}>${swatch(n.byproduct.item)}
        <span class="dim">byproduct ${esc(iname(n.byproduct.item))}: ${formatRate(n.byproduct.rate)}</span></div>`;
    }
    return h + n.children.map((c) => nodeHtml(c, depth + 1)).join('');
  };
  let rh = '';
  for (const t of plan.trees) rh += `<h2>Make ${esc(iname(t.item))}</h2>` + nodeHtml(t.root, 0);
  rh += '<h2>Machines needed</h2>';
  for (const t of plan.recipes) {
    const out = RECIPES[t.recipe]!.output.item;
    rh += `<div class="rrow" data-item="${out}"><div class="rhead">${swatch(out)}<b>${esc(iname(out))}</b>
      <span class="badge">${badge(t.machines, t.machinesCeil)}</span></div>
      <div class="rline dim">${esc(partLabel(t.machine))} · ${t.recipe}</div></div>`;
  }
  rh += '<h2>Raw supply</h2>';
  for (const r of plan.raw) {
    const short = fCmp(r.supplied, r.needed) < 0;
    rh += `<div class="rrow" data-item="${r.item}"><div class="rhead">${swatch(r.item)}<b>${esc(iname(r.item))}</b>
      <span class="badge ${short ? 'bad' : 'ok'}">${short ? 'short' : 'ok'}</span></div>
      <div class="rline ${short ? 'bad' : 'dim'}">need ${formatRate(r.needed)}; supply ${r.supplied.n ? formatRate(r.supplied) : 'none'}</div></div>`;
  }
  for (const b of plan.byproducts) {
    rh += `<div class="rrow" data-item="${b.item}"><div class="rhead">${swatch(b.item)}<b>${esc(iname(b.item))}</b>
      <span class="badge warn">byproduct</span></div><div class="rline dim">${formatRate(b.rate)}; consume it or send to disposal</div></div>`;
  }
  recipesView.innerHTML = rh;
  recipesView.addEventListener('mouseover', (e) => {
    hoverItem = (e.target as HTMLElement).closest<HTMLElement>('[data-item]')?.dataset.item ?? null;
  });
  recipesView.addEventListener('mouseleave', () => { hoverItem = null; });

  // ----- machine tooltip -----
  const tip = el('div', 'tip');
  tip.style.display = 'none';
  canvasWrap.appendChild(tip);
  let tipKey = '';

  shell.append(left, canvasWrap, right);

  // ----- refresh -----
  function pickerMachine(): PartType | null {
    const sel = s.selectedConfigurable;
    if (sel && isMachine(sel.placement.type)) return sel.placement.type;
    if (s.tool.kind === 'part' && isMachine(s.tool.part)) return s.tool.part;
    return null;
  }

  let recipeKey = '';
  let filterKey = '';
  let diagramKey = '';
  let deadlockKey = '';
  let lastPlacementsRef: unknown = s.placements;

  function refresh(): void {
    if (lastPlacementsRef !== s.placements) {
      lastPlacementsRef = s.placements;
      if (lastEval) {
        evalStale = true;
        renderResult();
      }
    }
    const locked = s.locked;
    palette.classList.toggle('locked', locked);
    for (const t of toolButtons) {
      t.btn.classList.toggle('active', t.match());
      t.btn.disabled = locked;
    }
    undoBtn.disabled = locked || !s.history.past.length;
    redoBtn.disabled = locked || !s.history.future.length;
    clearBtn.disabled = locked || !s.placements.length;

    // pickers
    const machine = pickerMachine();
    const sel = s.selectedConfigurable;
    const sorterCtx = (sel && sel.placement.type === 'sorter') || (s.tool.kind === 'part' && s.tool.part === 'sorter');
    recipeSel.style.display = machine ? '' : 'none';
    filterSel.style.display = sorterCtx ? '' : 'none';
    picker.style.display = machine || sorterCtx ? '' : 'none';
    pickerLabel.textContent = sel ? `Selected ${partLabel(sel.placement.type)}` : 'New part';
    if (machine) {
      const opts = recipesFor(puzzle, machine, RECIPES);
      const key = machine + opts.join(',');
      if (key !== recipeKey) {
        recipeKey = key;
        recipeSel.innerHTML = opts
          .map((r) => {
            const rc = RECIPES[r]!;
            const ins = Object.entries(rc.inputs).map(([i, n]) => `${n} ${ITEMS[i]?.name ?? i}`).join(' + ');
            return `<option value="${r}">${esc(ITEMS[rc.output.item]?.name ?? rc.output.item)} (${esc(ins)})</option>`;
          })
          .join('');
      }
      const cur = sel?.placement.recipe ?? s.defaultRecipe[machine] ?? '';
      if (recipeSel.value !== cur) recipeSel.value = cur;
    }
    if (sorterCtx) {
      if (!filterKey) {
        filterKey = 'x';
        filterSel.innerHTML = Object.values(ITEMS)
          .map((i) => `<option value="${i.id}">${esc(i.name)}</option>`)
          .join('');
      }
      const cur = sel?.placement.filter ?? s.defaultFilter;
      if (filterSel.value !== cur) filterSel.value = cur;
    }

    // port diagram
    const dPart: PartType | null = sel ? sel.placement.type : s.tool.kind === 'part' ? s.tool.part : null;
    if (dPart && PARTS[dPart].ports.length) {
      const dRot: Rotation = sel ? sel.placement.rot : s.rot;
      const dRecipe = sel ? sel.placement.recipe : s.defaultRecipe[dPart];
      const rc = dRecipe ? RECIPES[dRecipe] : undefined;
      const key = `${dPart}${dRot}${dRecipe ?? ''}`;
      diagramBox.style.display = '';
      if (key !== diagramKey) {
        diagramKey = key;
        drawPortDiagram(diagramCanvas, dPart, dRot);
        diagramCap.textContent = rc ? `${partLabel(dPart)} · ${rc.craftTicks}t: ${recipeLine(rc)}` : partLabel(dPart);
      }
    } else diagramBox.style.display = 'none';

    // sim controls
    runBtn.textContent = s.running ? 'Pause' : s.sim ? 'Resume' : 'Run';
    resetBtn.disabled = !s.sim;
    canvasWrap.classList.toggle('running', locked);
    banner.textContent = locked ? (s.running ? 'Running - editing locked' : 'Paused - Reset to edit') : '';
    banner.style.display = locked ? '' : 'none';

    const snap = s.snapshot;
    status.textContent = snap
      ? `Tick ${snap.tick}${snap.firstDelivery !== null ? ` | first delivery at ${snap.firstDelivery}` : ''}`
      : `Edit mode | ${s.placements.length} parts`;

    let kh = '';
    if (snap) {
      for (const m of snap.machines) {
        if (!m.deadlocked) continue;
        const d = [...snap.deadlocks].reverse().find((x) => x.placement === m.placement);
        kh += `<button type="button" class="deadlock-line" data-placement="${m.placement}" title="${esc(deadlockTooltip(m))}">Deadlock at tick ${d ? d.tick : snap.tick}: ${esc(machineLabel(s.placements[m.placement]))}</button>`;
      }
    }
    if (kh !== deadlockKey) {
      deadlockKey = kh;
      deadlockBox.innerHTML = kh;
    }

    let dh = '';
    puzzle.demands.forEach((d, i) => {
      const dv = snap?.demands[i];
      const required = requiredDeliveries(d.rate, puzzle.windowTicks);
      const name = ITEMS[d.item]?.name ?? d.item;
      const got = dv ? dv.deliveredInWindow : 0;
      dh += `<div class="demand"><span class="dot" style="background:${ITEMS[d.item]?.color ?? '#fff'}"></span>${esc(name)}
        <span class="dim">${d.rate.count}/${d.rate.ticks}t</span>
        <b class="${got >= required ? 'ok' : ''}">${dv ? `${got}/${required}` : `need ${required}`}</b>${dv ? ` <span class="dim">(total ${dv.delivered})</span>` : ''}</div>`;
    });
    demandBox.innerHTML = dh;

    let eh = '';
    for (const e of s.errors) eh += `<div class="err">${esc(e.message)}${e.pos ? ` (${e.pos.x},${e.pos.y})` : ''}</div>`;
    if (snap && snap.jams.length) {
      const seen = new Set<string>();
      for (const j of snap.jams) {
        const k = `${j.pos.x},${j.pos.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        eh += `<div class="err">Jam at (${j.pos.x},${j.pos.y}): ${esc(j.reason)} (${esc(ITEMS[j.item]?.name ?? j.item)})</div>`;
      }
    }
    errorBox.innerHTML = eh;
    evalBtn.disabled = false;
  }

  function updateTooltip(hover: Vec | null, anchor: { x: number; y: number }): void {
    let key = '';
    const dm = hover && s.locked ? s.snapshot?.machines.find((m) => m.placement === placementAt(s.placements, hover)) : undefined;
    if (dm && dm.deadlocked) {
      key = `dl|${dm.placement}|${dm.waiting.join()}|${dm.missing.join()}|${Math.round(anchor.x)}|${Math.round(anchor.y)}`;
      if (key !== tipKey) {
        tip.innerHTML = `<b class="warn">${esc(deadlockTooltip(dm))}</b>`;
        tip.style.left = `${Math.round(anchor.x) + 8}px`;
        tip.style.top = `${Math.round(anchor.y)}px`;
      }
    } else if (hover && !s.locked && s.tool.kind !== 'belt' && s.tool.kind !== 'part') {
      const i = placementAt(s.placements, hover);
      const p = i >= 0 ? s.placements[i] : undefined;
      const rc = p?.recipe ? RECIPES[p.recipe] : undefined;
      if (p && rc && isMachine(p.type)) {
        key = `${i}|${p.recipe}|${Math.round(anchor.x)}|${Math.round(anchor.y)}`;
        if (key !== tipKey) {
          tip.innerHTML = `<b>${esc(partLabel(p.type))} · ${esc(iname(rc.output.item))}</b><br>${esc(recipeLine(rc))}<br><span class="dim">${rc.craftTicks} ticks per craft</span>`;
          tip.style.left = `${Math.round(anchor.x) + 8}px`;
          tip.style.top = `${Math.round(anchor.y)}px`;
        }
      }
    }
    if (key !== tipKey) tip.style.display = key ? '' : 'none';
    tipKey = key;
  }

  return { canvas, canvasWrap, refresh, highlightItem: () => hoverItem, updateTooltip };
}
