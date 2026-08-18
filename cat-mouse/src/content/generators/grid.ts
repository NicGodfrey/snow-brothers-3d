import type { TileGlyph } from '../schema';
import { WALKABLE } from '../validate';

export interface Grid {
  width: number;
  height: number;
  cells: TileGlyph[][];
}

export interface RectRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RngLike {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  bool(chance?: number): boolean;
  pick<T>(items: readonly T[]): T;
}

export function createGrid(width: number, height: number, fill: TileGlyph = '#'): Grid {
  const cells: TileGlyph[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: TileGlyph[] = [];
    for (let x = 0; x < width; x += 1) row.push(fill);
    cells.push(row);
  }
  return { width, height, cells };
}

export function inGrid(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function at(grid: Grid, x: number, y: number): TileGlyph {
  if (!inGrid(grid, x, y)) return '#';
  return grid.cells[y][x];
}

export function paint(grid: Grid, x: number, y: number, glyph: TileGlyph): void {
  if (inGrid(grid, x, y)) grid.cells[y][x] = glyph;
}

export function fillRect(grid: Grid, x: number, y: number, w: number, h: number, glyph: TileGlyph): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(grid.width, x + w);
  const y1 = Math.min(grid.height, y + h);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) paint(grid, xx, yy, glyph);
  }
}

export function sealBorder(grid: Grid, glyph: TileGlyph = '#'): void {
  for (let x = 0; x < grid.width; x += 1) {
    paint(grid, x, 0, glyph);
    paint(grid, x, grid.height - 1, glyph);
  }
  for (let y = 0; y < grid.height; y += 1) {
    paint(grid, 0, y, glyph);
    paint(grid, grid.width - 1, y, glyph);
  }
}

export function carveH(grid: Grid, x0: number, x1: number, y: number, glyph: TileGlyph = '.'): void {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let x = a; x <= b; x += 1) paint(grid, x, y, glyph);
}

export function carveV(grid: Grid, y0: number, y1: number, x: number, glyph: TileGlyph = '.'): void {
  const a = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  for (let y = a; y <= b; y += 1) paint(grid, x, y, glyph);
}

export function carveL(grid: Grid, x0: number, y0: number, x1: number, y1: number, horizontalFirst: boolean): void {
  if (horizontalFirst) {
    carveH(grid, x0, x1, y0);
    carveV(grid, y0, y1, x1);
  } else {
    carveV(grid, y0, y1, x0);
    carveH(grid, x0, x1, y1);
  }
}

export function rowsOf(grid: Grid): string[] {
  return grid.cells.map((row) => row.join(''));
}

export function cloneGrid(grid: Grid): Grid {
  return {
    width: grid.width,
    height: grid.height,
    cells: grid.cells.map((row) => row.slice()),
  };
}

export function isWalkableGlyph(glyph: string): boolean {
  return WALKABLE.has(glyph);
}

export function listWalkable(grid: Grid): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      if (isWalkableGlyph(at(grid, x, y))) spots.push({ x, y });
    }
  }
  return spots;
}

export function roomCenter(room: RectRoom): { x: number; y: number } {
  return {
    x: Math.floor(room.x + room.w / 2),
    y: Math.floor(room.y + room.h / 2),
  };
}

export function floodFrom(grid: Grid, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  if (!inGrid(grid, sx, sy) || !isWalkableGlyph(at(grid, sx, sy))) return seen;
  const stack = [sx, sy];
  seen.add(sy * grid.width + sx);
  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (!inGrid(grid, nx, ny) || !isWalkableGlyph(at(grid, nx, ny))) continue;
      const key = ny * grid.width + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(nx, ny);
    }
  }
  return seen;
}

export function farthestWalkable(
  grid: Grid,
  fromX: number,
  fromY: number,
): { x: number; y: number } {
  const reachable = floodFrom(grid, fromX, fromY);
  let best = { x: fromX, y: fromY };
  let bestD = -1;
  for (const key of reachable) {
    const x = key % grid.width;
    const y = Math.floor(key / grid.width);
    const d = Math.abs(x - fromX) + Math.abs(y - fromY);
    if (d > bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

export function randomWalkable(grid: Grid, rng: RngLike, avoid: { x: number; y: number }[] = []): { x: number; y: number } | null {
  const spots = listWalkable(grid).filter((spot) => !avoid.some((a) => a.x === spot.x && a.y === spot.y));
  if (spots.length === 0) return null;
  return rng.pick(spots);
}

export function decorRows(grid: Grid, rng: RngLike, salt: number): string[] {
  const marks = [',', '`', '.', ' ', ' ', ' ', '+', '*', '='];
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    let row = '';
    for (let x = 0; x < grid.width; x += 1) {
      const glyph = at(grid, x, y);
      if (glyph === '#') {
        row += rng.bool(0.08) ? '+' : ' ';
      } else if (isWalkableGlyph(glyph)) {
        const pick = marks[(x * 17 + y * 31 + salt) % marks.length] ?? ' ';
        row += pick;
      } else {
        row += rng.bool(0.2) ? '=' : ' ';
      }
    }
    rows.push(row);
  }
  return rows;
}
