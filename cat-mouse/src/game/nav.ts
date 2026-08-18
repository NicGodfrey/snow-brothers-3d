import { findPath } from '../engine/pathfinding';
import type { GridPoint, PathResult, TileMapLike } from '../engine/types';
import { tileBlocks } from './tiles';

/**
 * Gameplay wrapper around the engine A*. Cats pass `allowMouseOnly: false`
 * so vents, holes and table-undersides stay mouse-only cover.
 */
export function findGridPath(
  tiles: TileMapLike,
  start: GridPoint,
  goal: GridPoint,
  allowMouseOnly = false,
  maxNodes = 1400,
): PathResult {
  return findPath(tiles, {
    start: { x: Math.trunc(start.x), y: Math.trunc(start.y) },
    goal: { x: Math.trunc(goal.x), y: Math.trunc(goal.y) },
    allowMouseOnly,
    maxNodes,
  });
}

export function pathToWorld(nodes: readonly GridPoint[]): { x: number; y: number }[] {
  return nodes.map((n) => ({ x: n.x + 0.5, y: n.y + 0.5 }));
}

function walkable(tiles: TileMapLike, x: number, y: number, allowMouseOnly: boolean): boolean {
  if (!tiles.inBounds(x, y)) return false;
  if (tileBlocks(tiles, x, y, allowMouseOnly)) return false;
  const cost = tiles.props(x, y).cost;
  return Number.isFinite(cost) && cost > 0;
}

export function nearestWalkable(
  tiles: TileMapLike,
  x: number,
  y: number,
  allowMouseOnly: boolean,
  radius = 3,
): GridPoint {
  const ox = Math.trunc(x);
  const oy = Math.trunc(y);
  if (walkable(tiles, ox, oy, allowMouseOnly)) return { x: ox, y: oy };
  for (let r = 1; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (walkable(tiles, ox + dx, oy + dy, allowMouseOnly)) return { x: ox + dx, y: oy + dy };
      }
    }
  }
  return { x: ox, y: oy };
}
