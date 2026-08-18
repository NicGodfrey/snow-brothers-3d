import type { ThemeId } from '../schema';
import { THEME_KITS } from '../themeKits';
import {
  at,
  createGrid,
  fillRect,
  paint,
  sealBorder,
  type Grid,
  type RngLike,
} from './grid';
import type { RectRoom } from './grid';
import type { RoomLayout } from './rooms';

const DIRS: readonly [number, number][] = [
  [0, -2],
  [2, 0],
  [0, 2],
  [-2, 0],
];

function oddInRange(rng: RngLike, min: number, maxExclusive: number): number {
  const span = maxExclusive - min;
  if (span <= 1) return min | 1;
  let value = rng.int(min, maxExclusive);
  if (value % 2 === 0) value += 1;
  if (value >= maxExclusive) value -= 2;
  if (value < min) value = min + (min % 2 === 0 ? 1 : 0);
  return value;
}

export function carveMaze(rng: RngLike, width: number, height: number): Grid {
  const grid = createGrid(width, height, '#');
  const sx = oddInRange(rng, 1, width - 1);
  const sy = oddInRange(rng, 1, height - 1);
  paint(grid, sx, sy, '.');
  const stack = [[sx, sy]];
  while (stack.length > 0) {
    const current = stack[stack.length - 1] as number[];
    const x = current[0] as number;
    const y = current[1] as number;
    const options: [number, number, number, number][] = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
      if (at(grid, nx, ny) !== '#') continue;
      options.push([nx, ny, x + dx / 2, y + dy / 2]);
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny, wx, wy] = rng.pick(options);
    paint(grid, wx, wy, '.');
    paint(grid, nx, ny, '.');
    stack.push([nx, ny]);
  }
  return grid;
}

export function braidMaze(grid: Grid, rng: RngLike, fraction: number): void {
  const dead: { x: number; y: number }[] = [];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      if (at(grid, x, y) !== '.') continue;
      let exits = 0;
      if (at(grid, x + 1, y) === '.') exits += 1;
      if (at(grid, x - 1, y) === '.') exits += 1;
      if (at(grid, x, y + 1) === '.') exits += 1;
      if (at(grid, x, y - 1) === '.') exits += 1;
      if (exits === 1) dead.push({ x, y });
    }
  }
  rng.pick(dead);
  const count = Math.floor(dead.length * fraction);
  for (let i = 0; i < count; i += 1) {
    const cell = dead[i];
    if (!cell) continue;
    const walls: [number, number][] = [];
    const n: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of n) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx <= 0 || ny <= 0 || nx >= grid.width - 1 || ny >= grid.height - 1) continue;
      if (at(grid, nx, ny) === '#') walls.push([nx, ny]);
    }
    if (walls.length === 0) continue;
    const [wx, wy] = rng.pick(walls);
    paint(grid, wx, wy, '.');
  }
}

export function openChambers(grid: Grid, rng: RngLike, count: number): RectRoom[] {
  const rooms: RectRoom[] = [];
  for (let i = 0; i < count; i += 1) {
    const w = 3 + rng.int(0, 4);
    const h = 3 + rng.int(0, 3);
    const x = rng.int(2, Math.max(3, grid.width - w - 2));
    const y = rng.int(2, Math.max(3, grid.height - h - 2));
    fillRect(grid, x, y, w, h, '.');
    rooms.push({ x, y, w, h });
  }
  return rooms;
}

export function paintMazeTheme(grid: Grid, theme: ThemeId, rng: RngLike): void {
  const kit = THEME_KITS[theme];
  for (let y = 1; y < grid.height - 1; y += 1) {
    for (let x = 1; x < grid.width - 1; x += 1) {
      if (at(grid, x, y) !== '.') continue;
      if (rng.bool(0.08)) paint(grid, x, y, kit.altFloor);
      else if (rng.bool(0.04)) paint(grid, x, y, rng.pick(kit.clutter));
      else if (kit.liquid && rng.bool(0.03)) paint(grid, x, y, kit.liquid);
    }
  }
}

export function buildMazeLayout(
  rng: RngLike,
  width: number,
  height: number,
  theme: ThemeId,
): RoomLayout {
  const w = width % 2 === 0 ? width - 1 : width;
  const h = height % 2 === 0 ? height - 1 : height;
  const grid = carveMaze(rng, w, h);
  braidMaze(grid, rng, 0.25 + rng.next() * 0.35);
  const rooms = openChambers(grid, rng, 2 + rng.int(0, 3));
  paintMazeTheme(grid, theme, rng);
  sealBorder(grid);
  if (grid.width !== width || grid.height !== height) {
    const grown = createGrid(width, height, '#');
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) paint(grown, x, y, at(grid, x, y));
    }
    if (width > grid.width) {
      for (let y = 1; y < height - 1; y += 1) paint(grown, width - 2, y, at(grown, width - 3, y) === '#' ? '.' : at(grown, width - 3, y));
    }
    if (height > grid.height) {
      for (let x = 1; x < width - 1; x += 1) paint(grown, x, height - 2, '.');
    }
    sealBorder(grown);
    return { grid: grown, rooms };
  }
  return { grid, rooms };
}
