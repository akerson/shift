import { PARTS } from './catalog';
import type { Dir, PortDef, PartType, Placement, Rotation, Vec } from './types';

export const DIR_VECS: readonly Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function step(p: Vec, d: Dir): Vec {
  const v = DIR_VECS[d]!;
  return { x: p.x + v.x, y: p.y + v.y };
}

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

export function rotateDir(d: Dir, r: Rotation): Dir {
  return ((d + r) % 4) as Dir;
}

export function vecKey(p: Vec): string {
  return `${p.x},${p.y}`;
}

/** Footprint size of a part at the given rotation. */
export function footprint(type: PartType, rot: Rotation): { w: number; h: number } {
  const def = PARTS[type];
  return rot % 2 === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}

/** Rotate a local point in a w×h box by one quarter turn clockwise. */
function rotLocal1(dx: number, dy: number, h: number): { dx: number; dy: number } {
  return { dx: h - 1 - dy, dy: dx };
}

/** A part's ports at the given rotation, still in local (top-left = 0,0) coordinates. */
export function rotatedPorts(type: PartType, rot: Rotation): PortDef[] {
  const def = PARTS[type];
  return def.ports.map((p) => {
    let { dx, dy } = p;
    let w = def.w;
    let h = def.h;
    for (let i = 0; i < rot; i++) {
      ({ dx, dy } = rotLocal1(dx, dy, h));
      [w, h] = [h, w];
    }
    return { dx, dy, side: rotateDir(p.side, rot), kind: p.kind };
  });
}

/** All grid tiles a placement covers. */
export function placementTiles(p: Placement): Vec[] {
  const { w, h } = footprint(p.type, p.rot);
  const out: Vec[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push({ x: p.pos.x + x, y: p.pos.y + y });
  return out;
}

export interface WorldPort {
  kind: PortDef['kind'];
  /** Tile of the part the port is on. */
  tile: Vec;
  /** Direction the port faces (outward from the part). */
  side: Dir;
  /** The outside neighbour tile that connects to this port. */
  neighbor: Vec;
}

/** A placement's ports in world coordinates. */
export function placementPorts(p: Placement): WorldPort[] {
  return rotatedPorts(p.type, p.rot).map((port) => {
    const tile = { x: p.pos.x + port.dx, y: p.pos.y + port.dy };
    return { kind: port.kind, tile, side: port.side, neighbor: step(tile, port.side) };
  });
}
