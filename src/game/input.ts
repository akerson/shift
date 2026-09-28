// Pointer and keyboard handling. Translates DOM events into Session calls.

import type { PartType } from '../shared/types';
import type { Renderer } from './render';
import type { Session } from './session';

export interface InputHooks {
  now(): number;
}

export function attachInput(canvas: HTMLCanvasElement, r: Renderer, s: Session, hooks: InputHooks): void {
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    s.pointerDown(r.tileAt(e.clientX, e.clientY), e.button, e.shiftKey);
  });
  canvas.addEventListener('pointermove', (e) => s.pointerMove(r.tileAt(e.clientX, e.clientY)));
  canvas.addEventListener('pointerup', () => s.pointerUp());
  canvas.addEventListener('pointercancel', () => s.cancelDrag());
  canvas.addEventListener('pointerleave', () => {
    if (!s.drag) s.hover = null;
  });

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (!(e.ctrlKey || e.metaKey)) return;
    }
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (key === 'y') {
        e.preventDefault();
        s.redo();
      }
      return;
    }
    if (key === 'r') s.rotateContext();
    else if (key === 'e') s.setTool({ kind: 'erase' });
    else if (key === 'q' || key === 'escape') {
      s.setTool({ kind: 'select' });
      s.selected = [];
      s.notify();
    } else if (key === 'b' && s.puzzle.parts.includes('belt')) s.setTool({ kind: 'belt' });
    else if (key === 'delete' || key === 'backspace') s.deleteSelected();
    else if (key === ' ') {
      e.preventDefault();
      s.toggleRun(hooks.now());
    } else if (key === '.') s.stepOnce(hooks.now());
    else if (/^[1-9]$/.test(key)) {
      const parts = s.puzzle.parts.filter((p) => p !== 'belt');
      const part = parts[Number(key) - 1] as PartType | undefined;
      if (part) s.setTool({ kind: 'part', part });
    }
  });
}
