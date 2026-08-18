import { circleRectIntersects } from '../engine/math';
import type { TileKind, TileMapLike, TileProps } from '../engine/types';
import { TILE_LEGEND, type TileGlyph } from '../content/schema';

export const TILE_PROPS: Readonly<Record<TileKind, TileProps>> = {
  void: {
    kind: 'void',
    solid: true,
    cost: Infinity,
    noise: 0,
    scentRetention: 0,
    opaque: true,
    mouseOnly: false,
  },
  floor: {
    kind: 'floor',
    solid: false,
    cost: 1,
    noise: 1,
    scentRetention: 0.72,
    opaque: false,
    mouseOnly: false,
  },
  wall: {
    kind: 'wall',
    solid: true,
    cost: Infinity,
    noise: 0,
    scentRetention: 0,
    opaque: true,
    mouseOnly: false,
  },
  crate: {
    kind: 'crate',
    solid: true,
    cost: Infinity,
    noise: 0.15,
    scentRetention: 0.25,
    opaque: true,
    mouseOnly: false,
  },
  table: {
    kind: 'table',
    solid: false,
    cost: 1.35,
    noise: 0.55,
    scentRetention: 0.48,
    opaque: false,
    mouseOnly: true,
  },
  water: {
    kind: 'water',
    solid: false,
    cost: 1.85,
    noise: 2.15,
    scentRetention: 0.12,
    opaque: false,
    mouseOnly: false,
  },
  grate: {
    kind: 'grate',
    solid: false,
    cost: 1.2,
    noise: 1.55,
    scentRetention: 0.38,
    opaque: false,
    mouseOnly: false,
  },
  vent: {
    kind: 'vent',
    solid: false,
    cost: 1.08,
    noise: 0.42,
    scentRetention: 0.88,
    opaque: false,
    mouseOnly: true,
  },
  hole: {
    kind: 'hole',
    solid: false,
    cost: 1,
    noise: 0.28,
    scentRetention: 0.18,
    opaque: false,
    mouseOnly: true,
  },
  door: {
    kind: 'door',
    solid: true,
    cost: Infinity,
    noise: 0.85,
    scentRetention: 0.22,
    opaque: true,
    mouseOnly: false,
  },
  oneWay: {
    kind: 'oneWay',
    solid: false,
    cost: 1,
    noise: 1,
    scentRetention: 0.6,
    opaque: false,
    mouseOnly: false,
  },
  rug: {
    kind: 'rug',
    solid: false,
    cost: 0.88,
    noise: 0.32,
    scentRetention: 0.86,
    opaque: false,
    mouseOnly: false,
  },
  glass: {
    kind: 'glass',
    solid: true,
    cost: Infinity,
    noise: 0,
    scentRetention: 0,
    opaque: false,
    mouseOnly: false,
  },
  pipe: {
    kind: 'pipe',
    solid: false,
    cost: 1.28,
    noise: 1.38,
    scentRetention: 0.5,
    opaque: false,
    mouseOnly: true,
  },
  stairs: {
    kind: 'stairs',
    solid: false,
    cost: 1.16,
    noise: 1.28,
    scentRetention: 0.52,
    opaque: false,
    mouseOnly: false,
  },
  ledge: {
    kind: 'ledge',
    solid: false,
    cost: 1.22,
    noise: 0.78,
    scentRetention: 0.4,
    opaque: false,
    mouseOnly: false,
  },
};

const OPEN_DOOR: TileProps = {
  kind: 'door',
  solid: false,
  cost: 1.06,
  noise: 0.9,
  scentRetention: 0.35,
  opaque: false,
  mouseOnly: false,
};

export class GameTileMap implements TileMapLike {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  private readonly kinds: TileKind[];
  private readonly openDoors = new Set<number>();

  constructor(width: number, height: number, tileSize: number, kinds: TileKind[]) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    const expected = width * height;
    if (kinds.length !== expected) {
      const padded = kinds.slice(0, expected);
      while (padded.length < expected) padded.push('wall');
      this.kinds = padded;
    } else {
      this.kinds = kinds.slice();
    }
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  at(tx: number, ty: number): TileKind {
    if (!this.inBounds(tx, ty)) return 'void';
    return this.kinds[this.index(tx, ty)] ?? 'void';
  }

  setKind(tx: number, ty: number, kind: TileKind): void {
    if (!this.inBounds(tx, ty)) return;
    this.kinds[this.index(tx, ty)] = kind;
  }

  props(tx: number, ty: number): TileProps {
    const kind = this.at(tx, ty);
    if (kind === 'door' && this.openDoors.has(this.index(tx, ty))) return OPEN_DOOR;
    return TILE_PROPS[kind];
  }

  solid(tx: number, ty: number): boolean {
    return this.props(tx, ty).solid;
  }

  opaque(tx: number, ty: number): boolean {
    return this.props(tx, ty).opaque;
  }

  setDoorOpen(tx: number, ty: number, open: boolean): void {
    if (!this.inBounds(tx, ty)) return;
    const i = this.index(tx, ty);
    if (open) this.openDoors.add(i);
    else this.openDoors.delete(i);
  }

  isDoorOpen(tx: number, ty: number): boolean {
    return this.openDoors.has(this.index(tx, ty));
  }

  tileOf(x: number, y: number): { tx: number; ty: number } {
    return { tx: Math.floor(x), ty: Math.floor(y) };
  }

  center(tx: number, ty: number): { x: number; y: number } {
    return { x: tx + 0.5, y: ty + 0.5 };
  }
}

export function parseTileGlyph(ch: string): TileKind {
  const glyph = (ch.length === 0 ? ' ' : ch[0]) as TileGlyph;
  return TILE_LEGEND[glyph] ?? 'floor';
}

export function tilesFromRows(rows: readonly string[], width: number, height: number, tileSize: number): GameTileMap {
  const kinds: TileKind[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = rows[y] ?? '';
    for (let x = 0; x < width; x += 1) {
      kinds.push(parseTileGlyph(row[x] ?? '#'));
    }
  }
  return new GameTileMap(width, height, tileSize, kinds);
}

export function makeOpenTiles(width: number, height: number, tileSize = 1, wallBorder = true): GameTileMap {
  const kinds: TileKind[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const border = wallBorder && (x === 0 || y === 0 || x === width - 1 || y === height - 1);
      kinds.push(border ? 'wall' : 'floor');
    }
  }
  return new GameTileMap(width, height, tileSize, kinds);
}

export function tileBlocks(
  tiles: TileMapLike,
  tx: number,
  ty: number,
  allowMouseOnly: boolean,
): boolean {
  if (!tiles.inBounds(tx, ty)) return true;
  const props = tiles.props(tx, ty);
  if (props.solid) return true;
  if (props.mouseOnly && !allowMouseOnly) return true;
  return false;
}

export function circleBlocked(
  tiles: TileMapLike,
  x: number,
  y: number,
  radius: number,
  allowMouseOnly: boolean,
): boolean {
  const minTx = Math.floor(x - radius);
  const maxTx = Math.floor(x + radius);
  const minTy = Math.floor(y - radius);
  const maxTy = Math.floor(y + radius);
  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!tileBlocks(tiles, tx, ty, allowMouseOnly)) continue;
      if (circleRectIntersects({ x, y, r: radius }, { x: tx, y: ty, w: 1, h: 1 })) return true;
    }
  }
  return false;
}

export interface MoveResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
}

/** Axis-separated circle vs tile collision so agents slide along walls. */
export function moveCircle(
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  dt: number,
  tiles: TileMapLike,
  allowMouseOnly: boolean,
): MoveResult {
  let nx = x + vx * dt;
  let ny = y;
  let hit = false;
  if (circleBlocked(tiles, nx, ny, radius, allowMouseOnly)) {
    nx = x;
    hit = true;
  }
  ny = y + vy * dt;
  if (circleBlocked(tiles, nx, ny, radius, allowMouseOnly)) {
    ny = y;
    hit = true;
  }
  if (circleBlocked(tiles, nx, ny, radius, allowMouseOnly)) {
    nx = x;
    ny = y;
    hit = true;
  }
  return { x: nx, y: ny, vx, vy, hit };
}

export function propsAtWorld(tiles: TileMapLike, x: number, y: number): TileProps {
  return tiles.props(Math.floor(x), Math.floor(y));
}

export function mouseHiddenAt(tiles: TileMapLike, x: number, y: number): boolean {
  return tiles.props(Math.floor(x), Math.floor(y)).mouseOnly;
}
