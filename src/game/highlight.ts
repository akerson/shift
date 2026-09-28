// Which floor tiles "carry or produce" an item, for the recipe panel's hover highlight.
// Cheap enough to run every frame: one pass over sources, demands, placements and items.

import { RECIPES } from '../shared/catalog';
import { placementTiles, vecKey } from '../shared/geometry';
import type { ItemId, Placement, Puzzle } from '../shared/types';
import type { SimSnapshot } from '../sim/api';

export function highlightTiles(
  puzzle: Puzzle,
  placements: readonly Placement[],
  item: ItemId,
  snapshot: SimSnapshot | null,
): Set<string> {
  const out = new Set<string>();
  for (const s of puzzle.sources) if (s.item === item) out.add(vecKey(s.pos));
  for (const d of puzzle.demands) if (d.item === item) out.add(vecKey(d.pos));
  for (const p of placements) {
    const r = p.recipe ? RECIPES[p.recipe] : undefined;
    if (!r) continue;
    if (r.output.item === item || r.byproduct?.item === item || item in r.inputs) {
      for (const t of placementTiles(p)) out.add(vecKey(t));
    }
  }
  if (snapshot) for (const it of snapshot.items) if (it.item === item) out.add(vecKey(it.pos));
  return out;
}
