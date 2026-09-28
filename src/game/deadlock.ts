// Shared wording for deadlock diagnostics (tooltip, status line, evaluate panel).

import { ITEMS, RECIPES } from '../shared/catalog';
import type { Placement } from '../shared/types';
import { partLabel } from './state';

const iname = (i: string): string => ITEMS[i]?.name ?? i;

const list = (items: readonly string[]): string => items.map(iname).join(' and ');

/** "Iron Plate buffer full, waiting for Wire" */
export function deadlockReason(d: { waiting: readonly string[]; missing: readonly string[] }): string {
  const waiting = d.waiting.filter((w) => !d.missing.includes(w));
  return `${list(waiting)} buffer full, waiting for ${list(d.missing)}`;
}

/** "Deadlocked: Iron Plate buffer full, waiting for Wire" */
export function deadlockTooltip(d: { waiting: readonly string[]; missing: readonly string[] }): string {
  return `Deadlocked: ${deadlockReason(d)}`;
}

/** "Assembler (Circuit)" */
export function machineLabel(p: Placement | undefined): string {
  if (!p) return 'Machine';
  const rc = p.recipe ? RECIPES[p.recipe] : undefined;
  return rc ? `${partLabel(p.type)} (${iname(rc.output.item)})` : partLabel(p.type);
}
