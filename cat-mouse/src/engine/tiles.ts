/**
 * Tile map storage plus the single source of truth for tile behaviour.
 * Physics, pathfinding, scent and the renderer all read `TILE_PROPS`.
 */

import type { Bounds, GridPoint, Rect, TileKind, TileMapLike, TileProps, Vec2 } from './types';

function props(
  kind: TileKind,
  solid: boolean,
  cost: number,
  noise: number,
  scentRetention: number,
  opaque: boolean,
  mouseOnly: boolean,
): TileProps {
  return { kind, solid, cost, noise, scentRetention, opaque, mouseOnly };
}

/** Behaviour for every tile kind. Impassable tiles use `Infinity` cost. */
export const TILE_PROPS: Readonly<Record<TileKind, TileProps>> = {
  void: props('void', true, Infinity, 0, 0, false, false),
  floor: props('floor', false, 1, 1, 0.86, false, false),
  wall: props('wall', true, Infinity, 0, 0, true, false),
  crate: props('crate', true, Infinity, 0, 0, true, false),
  table: props('table', true, Infinity, 0, 0, false, false),
  water: props('water', false, 2.6, 2.4, 0.12, false, false),
  grate: props('grate', false, 1.35, 1.9, 0.4, false, false),
  vent: props('vent', false, 1.1, 0.6, 0.55, false, true),
  hole: props('hole', false, 1, 0.4, 0.7, false, true),
  door: props('door', false, 1.2, 1.3, 0.75, true, false),
  oneWay: props('oneWay', false, 1.15, 0.9, 0.7, false, false),
  rug: props('rug', false, 1.05, 0.35, 0.95, false, false),
  glass: props('glass', true, Infinity, 0, 0, false, false),
  pipe: props('pipe', false, 1.4, 1.1, 0.5, false, true),
  stairs: props('stairs', false, 1.5, 1.2, 0.8, false, false),
  ledge: props('ledge', false, 1.25, 0.7, 0.65, false, true),
};

export function tileProps(kind: TileKind): TileProps {
  return TILE_PROPS[kind];
}

/** True when the tile blocks a body of the given size class. */
export function blocksAgent(kind: TileKind, allowMouseOnly: boolean): boolean {
  const p = TILE_PROPS[kind];
  if (p.solid) return true;
  if (p.mouseOnly && !allowMouseOnly) return true;
  return false;
}

export interface TileMapInit {
  width: number;
  height: number;
  tileSize: number;
  tiles: readonly TileKind[];
  decor?: readonly number[];
}

export class TileMap implements TileMapLike {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  private readonly cells: TileKind[];
  private readonly decorCells: number[];

  constructor(init: TileMapInit) {
    this.width = init.width;
    this.height = init.height;
    this.tileSize = init.tileSize;
    if (init.tiles.length !== init.width * init.height) {
      throw new Error(
        `TileMap expects ${init.width * init.height} tiles, received ${init.tiles.length}`,
      );
    }
    this.cells = [...init.tiles];
    this.decorCells = init.decor ? [...init.decor] : new Array(this.cells.length).fill(0);
  }

  static filled(width: number, height: number, tileSize: number, kind: TileKind = 'floor'): TileMap {
    return new TileMap({
      width,
      height,
      tileSize,
      tiles: new Array(width * height).fill(kind),
    });
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  at(tx: number, ty: number): TileKind {
    if (!this.inBounds(tx, ty)) return 'void';
    return this.cells[this.index(tx, ty)];
  }

  set(tx: number, ty: number, kind: TileKind): void {
    if (!this.inBounds(tx, ty)) return;
    this.cells[this.index(tx, ty)] = kind;
  }

  decorAt(tx: number, ty: number): number {
    if (!this.inBounds(tx, ty)) return 0;
    return this.decorCells[this.index(tx, ty)];
  }

  setDecor(tx: number, ty: number, value: number): void {
    if (!this.inBounds(tx, ty)) return;
    this.decorCells[this.index(tx, ty)] = value;
  }

  props(tx: number, ty: number): TileProps {
    return TILE_PROPS[this.at(tx, ty)];
  }

  solid(tx: number, ty: number): boolean {
    return this.props(tx, ty).solid;
  }

  /** Solid for an agent that may or may not squeeze into mouse-only tiles. */
  blocked(tx: number, ty: number, allowMouseOnly = true): boolean {
    if (!this.inBounds(tx, ty)) return true;
    return blocksAgent(this.at(tx, ty), allowMouseOnly);
  }

  opaque(tx: number, ty: number): boolean {
    return this.props(tx, ty).opaque;
  }

  cost(tx: number, ty: number, allowMouseOnly = true): number {
    if (this.blocked(tx, ty, allowMouseOnly)) return Infinity;
    return this.props(tx, ty).cost;
  }

  toTileX(worldX: number): number {
    return Math.floor(worldX / this.tileSize);
  }

  toTileY(worldY: number): number {
    return Math.floor(worldY / this.tileSize);
  }

  toWorldX(tx: number): number {
    return (tx + 0.5) * this.tileSize;
  }

  toWorldY(ty: number): number {
    return (ty + 0.5) * this.tileSize;
  }

  tileAtWorld(worldX: number, worldY: number): TileKind {
    return this.at(this.toTileX(worldX), this.toTileY(worldY));
  }

  propsAtWorld(worldX: number, worldY: number): TileProps {
    return this.props(this.toTileX(worldX), this.toTileY(worldY));
  }

  tileRect(tx: number, ty: number): Rect {
    return { x: tx * this.tileSize, y: ty * this.tileSize, w: this.tileSize, h: this.tileSize };
  }

  get pixelWidth(): number {
    return this.width * this.tileSize;
  }

  get pixelHeight(): number {
    return this.height * this.tileSize;
  }

  bounds(): Bounds {
    return { minX: 0, minY: 0, maxX: this.pixelWidth, maxY: this.pixelHeight };
  }

  /** Tile coordinates overlapped by a world-space rectangle. */
  rectTileRange(r: Rect): { minX: number; minY: number; maxX: number; maxY: number } {
    return {
      minX: Math.max(0, Math.floor(r.x / this.tileSize)),
      minY: Math.max(0, Math.floor(r.y / this.tileSize)),
      maxX: Math.min(this.width - 1, Math.floor((r.x + r.w) / this.tileSize)),
      maxY: Math.min(this.height - 1, Math.floor((r.y + r.h) / this.tileSize)),
    };
  }

  forEach(fn: (kind: TileKind, tx: number, ty: number) => void): void {
    for (let ty = 0; ty < this.height; ty += 1) {
      for (let tx = 0; tx < this.width; tx += 1) {
        fn(this.cells[this.index(tx, ty)], tx, ty);
      }
    }
  }

  /** All in-bounds walkable neighbours, 4- or 8-connected. */
  neighbors(tx: number, ty: number, diagonal: boolean, allowMouseOnly = true): GridPoint[] {
    const out: GridPoint[] = [];
    const straight = [
      { x: tx, y: ty - 1 },
      { x: tx + 1, y: ty },
      { x: tx, y: ty + 1 },
      { x: tx - 1, y: ty },
    ];
    for (const n of straight) {
      if (!this.blocked(n.x, n.y, allowMouseOnly)) out.push(n);
    }
    if (!diagonal) return out;
    const diag = [
      { x: tx + 1, y: ty - 1, ax: tx + 1, ay: ty, bx: tx, by: ty - 1 },
      { x: tx + 1, y: ty + 1, ax: tx + 1, ay: ty, bx: tx, by: ty + 1 },
      { x: tx - 1, y: ty + 1, ax: tx - 1, ay: ty, bx: tx, by: ty + 1 },
      { x: tx - 1, y: ty - 1, ax: tx - 1, ay: ty, bx: tx, by: ty - 1 },
    ];
    for (const d of diag) {
      if (this.blocked(d.x, d.y, allowMouseOnly)) continue;
      // No corner cutting: both orthogonal neighbours must be open.
      if (this.blocked(d.ax, d.ay, allowMouseOnly) || this.blocked(d.bx, d.by, allowMouseOnly)) continue;
      out.push({ x: d.x, y: d.y });
    }
    return out;
  }

  /** Nearest walkable tile to the given tile, searched in rings. */
  nearestOpen(tx: number, ty: number, allowMouseOnly = true, maxRadius = 12): GridPoint | null {
    if (!this.blocked(tx, ty, allowMouseOnly)) return { x: tx, y: ty };
    for (let r = 1; r <= maxRadius; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (!this.blocked(nx, ny, allowMouseOnly)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  /** Bresenham line-of-sight test in tile space against opaque tiles. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const tx1 = Math.floor(x1);
    const ty1 = Math.floor(y1);
    const dx = Math.abs(tx1 - cx);
    const dy = Math.abs(ty1 - cy);
    const sx = cx < tx1 ? 1 : -1;
    const sy = cy < ty1 ? 1 : -1;
    let err = dx - dy;
    let guard = dx + dy + 2;
    while (guard-- > 0) {
      if (cx === tx1 && cy === ty1) return true;
      if (!(cx === Math.floor(x0) && cy === Math.floor(y0)) && this.opaque(cx, cy)) return false;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
      }
    }
    return false;
  }

  worldLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    return this.lineOfSight(
      ax / this.tileSize,
      ay / this.tileSize,
      bx / this.tileSize,
      by / this.tileSize,
    );
  }

  /** Collects the centre of every tile matching a predicate. */
  findTiles(match: (kind: TileKind) => boolean): Vec2[] {
    const out: Vec2[] = [];
    this.forEach((kind, tx, ty) => {
      if (match(kind)) out.push({ x: this.toWorldX(tx), y: this.toWorldY(ty) });
    });
    return out;
  }

  clone(): TileMap {
    return new TileMap({
      width: this.width,
      height: this.height,
      tileSize: this.tileSize,
      tiles: this.cells,
      decor: this.decorCells,
    });
  }

  /**
   * Builds a map from row strings. Unknown glyphs become `void`.
   * The default legend matches the content schema so stage ASCII stays portable.
   */
  static fromGlyphs(
    rows: readonly string[],
    tileSize = 16,
    glyphs: Readonly<Record<string, TileKind>> = DEFAULT_GLYPHS,
  ): TileMap {
    if (rows.length === 0) throw new Error('TileMap.fromGlyphs requires at least one row');
    const height = rows.length;
    const width = rows[0]!.length;
    const tiles: TileKind[] = [];
    for (let y = 0; y < height; y += 1) {
      const row = rows[y] ?? '';
      if (row.length !== width) {
        throw new Error(`TileMap.fromGlyphs row ${y} length ${row.length} != ${width}`);
      }
      for (let x = 0; x < width; x += 1) {
        tiles.push(glyphs[row[x] ?? ' '] ?? 'void');
      }
    }
    return new TileMap({ width, height, tileSize, tiles });
  }

  toArray(): readonly TileKind[] {
    return this.cells;
  }
}

/** Every `TileKind` in a stable order — used by tests and editors. */
export const TILE_KIND_LIST: readonly TileKind[] = [
  'void',
  'floor',
  'wall',
  'crate',
  'table',
  'water',
  'grate',
  'vent',
  'hole',
  'door',
  'oneWay',
  'rug',
  'glass',
  'pipe',
  'stairs',
  'ledge',
];

/** Default ASCII legend. Mirrors `TILE_LEGEND` in content schema. */
export const DEFAULT_GLYPHS: Readonly<Record<string, TileKind>> = {
  ' ': 'void',
  '.': 'floor',
  '#': 'wall',
  X: 'crate',
  T: 'table',
  '~': 'water',
  g: 'grate',
  v: 'vent',
  o: 'hole',
  D: 'door',
  _: 'oneWay',
  r: 'rug',
  G: 'glass',
  p: 'pipe',
  s: 'stairs',
  L: 'ledge',
};

export function worldToTile(worldX: number, worldY: number, tileSize: number): GridPoint {
  return { x: Math.floor(worldX / tileSize), y: Math.floor(worldY / tileSize) };
}

export function worldToTileX(worldX: number, tileSize: number): number {
  return Math.floor(worldX / tileSize);
}

export function worldToTileY(worldY: number, tileSize: number): number {
  return Math.floor(worldY / tileSize);
}

/** World-space centre of a tile. */
export function tileToWorld(tx: number, ty: number, tileSize: number): Vec2 {
  return { x: (tx + 0.5) * tileSize, y: (ty + 0.5) * tileSize };
}

export function tileToWorldCorner(tx: number, ty: number, tileSize: number): Vec2 {
  return { x: tx * tileSize, y: ty * tileSize };
}

export function worldRectOfTile(tx: number, ty: number, tileSize: number): Rect {
  return { x: tx * tileSize, y: ty * tileSize, w: tileSize, h: tileSize };
}

export function walkable(kind: TileKind, allowMouseOnly = true): boolean {
  return !blocksAgent(kind, allowMouseOnly);
}
