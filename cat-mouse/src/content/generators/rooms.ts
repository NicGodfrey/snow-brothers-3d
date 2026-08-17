import type { ThemeId, TileGlyph } from '../schema';
import { THEME_KITS } from '../themeKits';
import {
  at,
  carveH,
  carveL,
  carveV,
  createGrid,
  fillRect,
  paint,
  roomCenter,
  sealBorder,
  type Grid,
  type RectRoom,
  type RngLike,
} from './grid';

export interface RoomLayout {
  grid: Grid;
  rooms: RectRoom[];
}

export function splitRooms(
  rng: RngLike,
  x: number,
  y: number,
  w: number,
  h: number,
  minW: number,
  minH: number,
  rooms: RectRoom[],
  depth: number,
): void {
  const canH = w >= minW * 2 + 2;
  const canV = h >= minH * 2 + 2;
  if (depth <= 0 || (!canH && !canV) || rng.bool(0.18)) {
    rooms.push({ x, y, w, h });
    return;
  }
  const splitVertical = canH && (!canV || rng.bool(0.5));
  if (splitVertical) {
    const cut = rng.int(minW, w - minW + 1);
    splitRooms(rng, x, y, cut, h, minW, minH, rooms, depth - 1);
    splitRooms(rng, x + cut, y, w - cut, h, minW, minH, rooms, depth - 1);
  } else {
    const cut = rng.int(minH, h - minH + 1);
    splitRooms(rng, x, y, w, cut, minW, minH, rooms, depth - 1);
    splitRooms(rng, x, y + cut, w, h - cut, minW, minH, rooms, depth - 1);
  }
}

export function carveRoom(grid: Grid, room: RectRoom, pad = 1, glyph: TileGlyph = '.'): void {
  const x0 = room.x + pad;
  const y0 = room.y + pad;
  const w = Math.max(1, room.w - pad * 2);
  const h = Math.max(1, room.h - pad * 2);
  fillRect(grid, x0, y0, w, h, glyph);
}

export function connectRooms(grid: Grid, rooms: readonly RectRoom[], rng: RngLike): void {
  const ordered = rooms.slice().sort((a, b) => a.x + a.y - (b.x + b.y));
  for (let i = 1; i < ordered.length; i += 1) {
    const a = roomCenter(ordered[i - 1] as RectRoom);
    const b = roomCenter(ordered[i] as RectRoom);
    carveL(grid, a.x, a.y, b.x, b.y, rng.bool());
    if (rng.bool(0.35) && i + 1 < ordered.length) {
      const c = roomCenter(ordered[i + 1] as RectRoom);
      carveL(grid, a.x, a.y, c.x, c.y, rng.bool());
    }
  }
}

export function furnishRooms(grid: Grid, rooms: readonly RectRoom[], theme: ThemeId, rng: RngLike): void {
  const kit = THEME_KITS[theme];
  for (const room of rooms) {
    const cx = roomCenter(room);
    if (room.w >= 7 && room.h >= 6 && rng.bool(0.55)) {
      const iw = Math.max(1, Math.floor(room.w / 4));
      const ih = Math.max(1, Math.floor(room.h / 4));
      fillRect(grid, cx.x - Math.floor(iw / 2), cx.y - Math.floor(ih / 2), iw, ih, rng.pick(kit.clutter));
      paint(grid, cx.x - Math.floor(iw / 2) - 1, cx.y, '.');
      paint(grid, cx.x + Math.ceil(iw / 2), cx.y, '.');
    }
    const scatter = 2 + rng.int(0, 4);
    for (let i = 0; i < scatter; i += 1) {
      const x = rng.int(room.x + 1, room.x + room.w - 1);
      const y = rng.int(room.y + 1, room.y + room.h - 1);
      if (at(grid, x, y) !== '.') continue;
      if (rng.bool(0.45)) paint(grid, x, y, kit.altFloor);
      else if (rng.bool(0.4)) paint(grid, x, y, rng.pick(kit.clutter));
    }
    if (kit.liquid && rng.bool(0.22) && room.w >= 6) {
      const lx = rng.int(room.x + 2, room.x + room.w - 2);
      carveV(grid, room.y + 2, room.y + room.h - 3, lx, kit.liquid);
      paint(grid, lx, room.y + 1, '.');
      paint(grid, lx, room.y + room.h - 2, '.');
    }
  }
}

export function buildRoomLayout(
  rng: RngLike,
  width: number,
  height: number,
  theme: ThemeId,
  depth = 4,
): RoomLayout {
  const grid = createGrid(width, height, '#');
  const rooms: RectRoom[] = [];
  splitRooms(rng, 1, 1, width - 2, height - 2, 5, 4, rooms, depth);
  if (rooms.length === 0) rooms.push({ x: 1, y: 1, w: width - 2, h: height - 2 });
  for (const room of rooms) carveRoom(grid, room, 1, '.');
  connectRooms(grid, rooms, rng);
  furnishRooms(grid, rooms, theme, rng);
  sealBorder(grid);
  return { grid, rooms };
}

export function buildOpenIslands(rng: RngLike, width: number, height: number, theme: ThemeId): RoomLayout {
  const grid = createGrid(width, height, '#');
  fillRect(grid, 1, 1, width - 2, height - 2, '.');
  const kit = THEME_KITS[theme];
  const islands = 4 + rng.int(0, 6);
  const rooms: RectRoom[] = [{ x: 1, y: 1, w: width - 2, h: height - 2 }];
  for (let i = 0; i < islands; i += 1) {
    const w = 2 + rng.int(0, 4);
    const h = 2 + rng.int(0, 3);
    const x = rng.int(2, width - w - 2);
    const y = rng.int(2, height - h - 2);
    fillRect(grid, x, y, w, h, rng.pick(kit.clutter));
    rooms.push({ x, y, w, h });
    paint(grid, x - 1, y, '.');
    paint(grid, x + w, y + h - 1, '.');
  }
  const rugs = 3 + rng.int(0, 5);
  for (let i = 0; i < rugs; i += 1) {
    paint(grid, rng.int(2, width - 2), rng.int(2, height - 2), kit.altFloor);
  }
  sealBorder(grid);
  return { grid, rooms };
}

export function buildGalleries(rng: RngLike, width: number, height: number, theme: ThemeId): RoomLayout {
  const grid = createGrid(width, height, '#');
  const rooms: RectRoom[] = [];
  const kit = THEME_KITS[theme];
  const rows = 2 + (height > 14 ? 1 : 0);
  const rowH = Math.floor((height - 2) / rows);
  for (let r = 0; r < rows; r += 1) {
    const y = 1 + r * rowH;
    const h = r === rows - 1 ? height - 1 - y : rowH - 1;
    fillRect(grid, 1, y, width - 2, Math.max(2, h), '.');
    rooms.push({ x: 1, y, w: width - 2, h: Math.max(2, h) });
    const doors = 2 + rng.int(0, 3);
    for (let d = 0; d < doors; d += 1) {
      const x = 2 + rng.int(0, width - 4);
      if (y + h < height - 1) paint(grid, x, y + h, '.');
    }
    if (r % 2 === 1) {
      for (let x = 3; x < width - 3; x += 4) paint(grid, x, y + 1, rng.pick(kit.clutter));
    } else {
      for (let x = 4; x < width - 3; x += 5) paint(grid, x, y + Math.max(1, h - 2), kit.altFloor);
    }
  }
  sealBorder(grid);
  return { grid, rooms };
}

export function buildChannels(rng: RngLike, width: number, height: number, theme: ThemeId): RoomLayout {
  const grid = createGrid(width, height, '#');
  const kit = THEME_KITS[theme];
  const vertical = rng.bool();
  const rooms: RectRoom[] = [];
  if (vertical) {
    const count = 3 + rng.int(0, 2);
    const span = Math.floor((width - 2) / count);
    for (let i = 0; i < count; i += 1) {
      const x = 1 + i * span;
      const w = Math.max(2, span - 1);
      fillRect(grid, x, 1, w, height - 2, '.');
      rooms.push({ x, y: 1, w, h: height - 2 });
      if (i > 0) {
        const y = 2 + rng.int(0, height - 4);
        carveH(grid, x - 1, x, y);
        if (rng.bool()) carveH(grid, x - 1, x, height - 3 - (y % 3));
      }
      if (kit.liquid && i === 1) carveV(grid, 2, height - 3, x + 1, kit.liquid);
    }
  } else {
    const count = 2 + rng.int(0, 2);
    const span = Math.floor((height - 2) / count);
    for (let i = 0; i < count; i += 1) {
      const y = 1 + i * span;
      const h = Math.max(2, span - 1);
      fillRect(grid, 1, y, width - 2, h, '.');
      rooms.push({ x: 1, y, w: width - 2, h });
      if (i > 0) {
        const x = 2 + rng.int(0, width - 4);
        carveV(grid, y - 1, y, x);
      }
    }
  }
  for (let i = 0; i < 6; i += 1) {
    paint(grid, rng.int(2, width - 2), rng.int(2, height - 2), rng.bool() ? kit.altFloor : rng.pick(kit.clutter));
  }
  sealBorder(grid);
  return { grid, rooms };
}

export function buildRing(rng: RngLike, width: number, height: number, theme: ThemeId): RoomLayout {
  const grid = createGrid(width, height, '#');
  const kit = THEME_KITS[theme];
  fillRect(grid, 1, 1, width - 2, height - 2, '.');
  const insetX = 3 + rng.int(0, 2);
  const insetY = 3 + rng.int(0, 2);
  const innerW = Math.max(3, width - insetX * 2);
  const innerH = Math.max(3, height - insetY * 2);
  fillRect(grid, insetX, insetY, innerW, innerH, '#');
  const punches = 1 + rng.int(0, 3);
  for (let i = 0; i < punches; i += 1) {
    if (rng.bool()) paint(grid, rng.int(insetX, insetX + innerW), insetY, '.');
    else paint(grid, insetX, rng.int(insetY, insetY + innerH), '.');
    if (rng.bool()) paint(grid, rng.int(insetX, insetX + innerW), insetY + innerH - 1, '.');
  }
  if (kit.liquid && innerW > 4 && innerH > 4) {
    fillRect(grid, insetX + 1, insetY + 1, innerW - 2, innerH - 2, kit.liquid);
  }
  const rooms: RectRoom[] = [
    { x: 1, y: 1, w: width - 2, h: 2 },
    { x: 1, y: height - 3, w: width - 2, h: 2 },
    { x: 1, y: 1, w: 2, h: height - 2 },
    { x: width - 3, y: 1, w: 2, h: height - 2 },
  ];
  sealBorder(grid);
  return { grid, rooms };
}

export function buildDualHalls(rng: RngLike, width: number, height: number, theme: ThemeId): RoomLayout {
  const grid = createGrid(width, height, '#');
  const kit = THEME_KITS[theme];
  const splitX = Math.floor(width * (0.38 + rng.next() * 0.24));
  fillRect(grid, 1, 1, splitX - 2, height - 2, '.');
  fillRect(grid, splitX + 1, 1, width - splitX - 2, height - 2, '.');
  const links = 1 + rng.int(0, 2);
  for (let i = 0; i < links; i += 1) {
    const y = 2 + rng.int(0, height - 4);
    carveH(grid, splitX - 2, splitX + 1, y);
  }
  for (let y = 2; y < height - 2; y += 3) {
    paint(grid, 3, y, rng.pick(kit.clutter));
    paint(grid, width - 4, y, kit.altFloor);
  }
  const rooms: RectRoom[] = [
    { x: 1, y: 1, w: splitX - 2, h: height - 2 },
    { x: splitX + 1, y: 1, w: width - splitX - 2, h: height - 2 },
  ];
  sealBorder(grid);
  return { grid, rooms };
}
