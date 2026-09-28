# Simulation spec (v1)

The rules the engine in `src/sim/` must follow. `src/sim/api.ts` is the public contract, and types live in `src/shared/types.ts`. Part geometry lives in `src/shared/catalog.ts` and `src/shared/geometry.ts`.

Constraints: pure TypeScript, no DOM, **integer maths only** (no floats, no `Math.random`), and deterministic iteration order (placement index or tile order, never object-key order of dynamic maps).

## Coordinates and facing

- `x` increases east and `y` increases south. `Dir`: 0 = N, 1 = E, 2 = S, 3 = W.
- For 1×1 parts (belt, merger, splitter), `rot` is the **facing**, meaning the direction items leave.
- For multi-tile parts, `rot` is the number of clockwise quarter turns applied to the rotation-0 layout in `PARTS`. Use `placementPorts()` to get world-space ports.

## Holders

Anything that holds items is a *holder*:

| Holder | Capacity | Accepts from | Sends to |
|---|---|---|---|
| Belt | 1 item | back or either side (exactly one feeder, else a layout error) | tile in front |
| Merger | 1 item | the three non-front sides; round-robin among sides offering an item this tick | tile in front |
| Splitter | 1 item | its back only | round-robin among the three non-back sides whose neighbour accepts from that side |
| Sorter (1×2) | 1 item | its `in` port | `out` port if `item === filter`, else `reject` port |
| Machine input port | per-ingredient buffer, `bufferCapacity(recipe, item)` | the neighbour tile of the port | — |
| Machine output / byproduct | output buffer, 2 crafts' worth | — | the neighbour tile of that port |
| Source | pending emission | — | `step(pos, dir)` |
| Demand port | unlimited | the tile `step(pos, dir)` only | consumed |
| Disposal port | unlimited, any item | the tile `step(pos, dir)` only | consumed |

"X outputs into tile T from side S" means the part at T must accept from side S. For example, a belt facing north accepts from S (its back), E and W, but not N.

## Tick order

Each `step()` advances the tick counter `t` (the first step is tick 1) and does the following:

1. **Crafting.** For each machine in placement order:
   - If it's crafting, `progress += 1`. When `progress === craftTicks`, try to add the output (and byproduct) to the output buffers. If they don't fit, stay stalled with `progress === craftTicks` and retry each tick.
   - If it's idle (including just finishing this tick) and every ingredient buffer has at least the recipe count, consume the ingredients and start crafting with `progress = 0`.
   - Steady-state requirement: a smelter with a continuously fed input and a continuously drained output produces **exactly 1 plate every 6 ticks**. Pin this with a test.
2. **Movement.** Every item moves **at most one tile per tick**, and all moves happen simultaneously:
   - An item may move into a holder that is empty at the start of the tick, or whose item is itself moving out this tick. Chains move together as one line, and closed loops of full belts rotate.
   - Resolve with a dependency graph from sinks upstream, with explicit cycle handling. Don't rely on iteration order to decide who wins.
   - When several items want the same holder (only possible at mergers), the merger's round-robin pointer decides. Advance the pointer past the side that won.
   - A splitter chooses its target side by round-robin among outputs that can accept this tick. If none can, it waits.
   - Machine output ports push one item per port per tick. Machine input ports absorb one item per port per tick if the ingredient buffer has room. A full buffer is **backpressure** (the item waits, not a jam).
   - Demand and disposal ports consume immediately, one item per tick.
3. **Sources.** Each source keeps an accumulator: `acc = min(acc + count, ticks + count - 1)` (for `count = 1` this is the same as capping at `ticks`; the extra headroom keeps rates like 2 per 3 ticks exact instead of losing the remainder). If `acc >= ticks` and the target holder is empty after movement, place one item there and do `acc -= ticks`. A blocked source just waits. That's not a failure.

The first item from a `{count: 1, ticks: 6}` source therefore appears on tick 6.

## Jams

A jam is recorded (once per holder per stuck item) when an item cannot move and never could with its current routing:

- `wrong-item`: the target is a demand port for another item, or a machine input port whose recipe doesn't use this item.
- `dead-end`: a belt, merger or sorter output points at empty floor, terrain, the grid edge, a source, or a machine tile that isn't an input port facing it.
- `rejected`: the target part never accepts from that side (for example two belts facing each other head-on, or a belt pointing into a splitter's side).

A jammed item stays put, so the line behind it backs up. Machine outputs and sources with nothing connected just block and don't jam.

## Layout validation (static, before simulating)

The outer ring of the floor (x = 0, y = 0, x = width-1, y = height-1) is reserved for sources, demand ports and disposal ports. Fixed ports must sit on a non-corner edge tile facing inward, and player parts may only cover interior tiles (`edge` error otherwise).

See `LayoutErrorCode`. Placements may not overlap each other, terrain, sources, demand ports or disposal ports, and they must be in bounds. Parts must be in `puzzle.parts`. Machines need a recipe that matches their type and is in `puzzle.recipes`. Sorters need a `filter`. A belt may have at most one feeder.

## Evaluation and scoring

`evaluate()` runs `warmupTicks + windowTicks` ticks. The window is ticks `warmupTicks + 1 … warmupTicks + windowTicks`.

- A demand is **met** if `delivered >= floor(rate.count * windowTicks / rate.ticks)`, counting deliveries in the window only. (Floor, not ceiling: when the window is not a multiple of the rate period, a perfectly steady line delivers either floor or ceil items depending on phase, and it must still pass.)
- **Pass** requires no layout errors, no jams at any tick, and every demand met.
- **Footprint** is the bounding-box area over all tiles of all placements (0 if there are no placements).
- **Cost** is the sum of `PARTS[type].cost`.
- **Latency** is the tick the first correct item reached any demand port, or null if none did.

## Clarifications (engine implementation notes)

- **Feeders and arbitration.** Machine output ports take part in movement like any other holder: they compete for a merger slot and can be the single feeder of a belt. Sources insert only after movement, so they never beat a holder already in place. A splitter picks its output by round-robin (order: front, right, left) among outputs that could take an item this tick (ignoring merger arbitration); if it picks a merger and loses the merger's arbitration it waits that tick. Merger round-robin pointer favours the slot after the last winner; slots are the three non-front sides in clockwise order starting after the front.
- **Fixed point.** "Moves" are the greatest set of moving items consistent with the rules: assume every item moves, then withdraw any move whose target is neither empty nor itself moving (nor the arbitration winner). That is what makes full lines advance as a unit and closed loops rotate.
- **Jam targets.** A part entered from a side it never accepts (belt front, splitter side, sorter non-`in` tile, demand/disposal from the wrong side) is `rejected`. A machine tile that is not an input port facing the feeder, and the tiles `dead-end` lists, are `dead-end`. Splitters never jam (outputs that cannot accept are skipped); machine outputs and sources never jam.
- **Sorter.** Holds its item on the `in` tile (that is the tile reported in `ItemView`/`Jam`). Entering a sorter's second tile is `rejected`.
- **Machine ports.** Sources may feed a machine input port or a demand/disposal directly. An assembler's two input ports each absorb one item per tick and share the per-ingredient buffer.
- **Layout errors** are reported per placement (a placement can have several). `multiple-feeders` is only computed when no other error was found. Feeders are all things that output into the belt from a side it accepts: sources, belts, mergers, splitter sides, sorter lanes and machine outputs.
- **Jam recording.** Detected during the movement phase of the tick after the item arrived; `Jam.tick` is that tick. The demand-window/`Jam` lists are cumulative.

## Deadlock diagnostics

Assemblers accept either ingredient on either input port, so two ingredients can share one mixed belt. If one arrives faster than the recipe uses it, its buffer fills, the next item of it waits at the port (backpressure, not a jam), and the other ingredient stuck behind it never arrives. This is a deadlock. It is purely diagnostic: it never changes movement, and **pass/fail is still rates + no jams**.

`MachineView` gains:

- `waiting: ItemId[]`: items currently held at one of the machine's input ports (on the feeding belt/merger/sorter/machine output, or a source's pending emission) whose ingredient buffer is full. Port order, no duplicates.
- `missing: ItemId[]`: ingredients whose buffer is below the recipe count (recipe order). This is why a craft can't start.
- `deadlocked: boolean`: the machine is not crafting, `missing` is non-empty, and some `waiting` item is not itself missing, and this has held for **8 consecutive ticks** with the machine's input buffers unchanged. The debounce keeps ordinary backpressure on separate belts (a briefly slow ingredient) from being flagged. A machine with nothing waiting (merely starved) is never deadlocked.

`SimSnapshot.deadlocks` and `EvalResult.deadlocks` are lists of `{ tick, placement, waiting, missing }`, one entry per episode, in detection order. `tick` is the tick the machine was first confirmed deadlocked (the 8th stuck tick); `waiting`/`missing` are captured at that moment. A new entry is only added after the machine leaves the stuck condition and re-enters it. `EvalResult.deadlocks` is empty when layout errors prevent simulation.
