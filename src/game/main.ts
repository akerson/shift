import { parsePuzzle } from '../shared/puzzle';
import type { Puzzle } from '../shared/types';
import { footprint } from '../shared/geometry';
import { attachInput } from './input';
import { Renderer } from './render';
import { Session, loadBuild } from './session';
import { placementAt } from './state';
import { buildUI } from './ui';
import './style.css';

async function loadPuzzle(id: string): Promise<Puzzle> {
  const res = await fetch(`${import.meta.env.BASE_URL}puzzles/${encodeURIComponent(id)}.json`);
  if (!res.ok) throw new Error(`could not load puzzle "${id}" (HTTP ${res.status})`);
  return parsePuzzle(await res.json());
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const id = new URLSearchParams(location.search).get('puzzle') ?? 'hm-01-first-light';
  let puzzle: Puzzle;
  try {
    puzzle = await loadPuzzle(id);
  } catch (e) {
    root.textContent = `Failed to load puzzle: ${String(e)}`;
    return;
  }

  const session = new Session(puzzle, loadBuild(puzzle.id) ?? []);
  const ui = buildUI(root, session, () => performance.now());
  const renderer = new Renderer(ui.canvas, puzzle);
  attachInput(ui.canvas, renderer, session, { now: () => performance.now() });
  session.onChange(() => ui.refresh());

  const resize = () => renderer.resize();
  new ResizeObserver(resize).observe(ui.canvasWrap);
  window.addEventListener('resize', resize);
  resize();
  ui.refresh();

  const frame = (now: number) => {
    const alpha = session.frame(now);
    renderer.draw({
      puzzle,
      placements: session.placements,
      selected: new Set(session.selected),
      ghosts: session.ghosts(),
      hover: session.locked ? null : session.hover,
      selBox: session.drag?.kind === 'box' ? { a: session.drag.a, b: session.drag.b } : null,
      errors: session.locked ? [] : session.errors,
      snapshot: session.snapshot,
      alpha,
      timeMs: now,
      highlightItem: ui.highlightItem(),
      flashPlacement: session.flash && now < session.flash.until ? session.flash.placement : null,
    });
    const hp = session.hover ? session.placements[placementAt(session.placements, session.hover)] : undefined;
    ui.updateTooltip(session.hover, hp ? { x: renderer.ox + (hp.pos.x + footprint(hp.type, hp.rot).w) * renderer.cell, y: renderer.oy + hp.pos.y * renderer.cell } : { x: 0, y: 0 });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
