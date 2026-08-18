#!/usr/bin/env node
/**
 * Deterministic unique StageDef emitter. Skips files that already exist so
 * hand-authored openers stay put. Re-run after adding ids to chapters.ts.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const content = join(root, 'src', 'content');

class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min, max) {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min));
  }
  bool(p = 0.5) {
    return this.next() < p;
  }
  pick(items) {
    return items[this.int(0, items.length)];
  }
  shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }
}

function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const THEMES = [
  'kitchen',
  'cellar',
  'alley',
  'sewer',
  'attic',
  'carnival',
  'museum',
  'subway',
  'docks',
  'greenhouse',
  'clocktower',
  'moonLab',
];

const KITS = {
  cellar: { clutter: ['X', 'T', 's'], alt: 'r', liquid: '~', hazards: ['snapTrap', 'sparkWire', 'glueBoard'], power: ['scentMask', 'featherFoot', 'noiseBomb'], breeds: ['persian', 'ragdoll', 'tabby', 'britishShorthair'], music: 'cellar-drip', ambient: 0.28, landmarks: ['wine rack', 'coal chute', 'furnace', 'jar wall'] },
  kitchen: { clutter: ['T', 'X', 'r'], alt: 'r', liquid: '~', hazards: ['snapTrap', 'glueBoard', 'broom'], power: ['speed', 'decoy', 'magnet'], breeds: ['tabby', 'calico', 'ragdoll', 'scottishFold'], music: 'kitchen-night', ambient: 0.62, landmarks: ['fridge', 'sink', 'oven', 'breadbox'] },
  alley: { clutter: ['X', 'G', 'p'], alt: 'g', liquid: '~', hazards: ['glueBoard', 'broom', 'fan'], power: ['noiseBomb', 'speed', 'invisibility'], breeds: ['bombay', 'siamese', 'bengal', 'calico'], music: 'alley-neon', ambient: 0.34, landmarks: ['dumpster', 'fire escape', 'neon', 'loading dock'] },
  sewer: { clutter: ['p', 'g', 'X'], alt: 'g', liquid: '~', hazards: ['water', 'fan', 'sparkWire'], power: ['featherFoot', 'scentMask', 'timeSlip'], breeds: ['sphynx', 'norwegianForest', 'bombay', 'manx'], music: 'sewer-flow', ambient: 0.3, landmarks: ['overflow', 'pump', 'outflow', 'grate well'] },
  attic: { clutter: ['X', 'L', 'v'], alt: 'r', liquid: null, hazards: ['snapTrap', 'glueBoard', 'broom'], power: ['invisibility', 'featherFoot', 'decoy'], breeds: ['ragdoll', 'scottishFold', 'russianBlue', 'tabby'], music: 'attic-moths', ambient: 0.4, landmarks: ['trunk', 'dormer', 'chimney', 'hatbox'] },
  carnival: { clutter: ['T', 'G', 'X'], alt: 'r', liquid: null, hazards: ['broom', 'fan', 'glueBoard'], power: ['speed', 'decoy', 'noiseBomb'], breeds: ['bengal', 'siamese', 'calico', 'manx'], music: 'carnival-closed', ambient: 0.48, landmarks: ['booth', 'bumper', 'mirrors', 'prize tent'] },
  museum: { clutter: ['T', 'G', 's'], alt: 'r', liquid: null, hazards: ['glueBoard', 'snapTrap', 'sparkWire'], power: ['scentMask', 'invisibility', 'timeSlip'], breeds: ['maineCoon', 'britishShorthair', 'russianBlue', 'persian'], music: 'museum-echo', ambient: 0.55, landmarks: ['foyer', 'armor', 'vase', 'vault'] },
  subway: { clutter: ['p', 's', 'X'], alt: 'g', liquid: null, hazards: ['sparkWire', 'fan', 'vacuum'], power: ['speed', 'noiseBomb', 'magnet'], breeds: ['bombay', 'savannah', 'siamese', 'abyssinian'], music: 'subway-last', ambient: 0.36, landmarks: ['platform', 'turnstile', 'kiosk', 'third rail'] },
  docks: { clutter: ['X', 'p', 'L'], alt: 'L', liquid: '~', hazards: ['water', 'fan', 'glueBoard'], power: ['featherFoot', 'magnet', 'extraLife'], breeds: ['norwegianForest', 'maineCoon', 'sphynx', 'tabby'], music: 'docks-foghorn', ambient: 0.32, landmarks: ['pier', 'nets', 'gangway', 'cold storage'] },
  greenhouse: { clutter: ['T', 'G', 'X'], alt: 'r', liquid: '~', hazards: ['water', 'glueBoard', 'fan'], power: ['scentMask', 'magnet', 'decoy'], breeds: ['abyssinian', 'sphynx', 'calico', 'scottishFold'], music: 'greenhouse-hum', ambient: 0.5, landmarks: ['seedlings', 'mist', 'orchids', 'agave'] },
  clocktower: { clutter: ['L', 'g', 'p'], alt: 's', liquid: null, hazards: ['sparkWire', 'fan', 'snapTrap'], power: ['timeSlip', 'featherFoot', 'freeze'], breeds: ['savannah', 'russianBlue', 'maineCoon', 'manx'], music: 'clocktower-tick', ambient: 0.38, landmarks: ['gears', 'pendulum', 'bell', 'escapement'] },
  moonLab: { clutter: ['G', 'v', 'D'], alt: 'G', liquid: null, hazards: ['sparkWire', 'vacuum', 'fan'], power: ['freeze', 'invisibility', 'extraLife'], breeds: ['savannah', 'bengal', 'siamese', 'britishShorthair'], music: 'moonlab-protocol', ambient: 0.7, landmarks: ['airlock', 'vault', 'centrifuge', 'cryo'] },
};

const STORY = [
  ['ch01-s01-crumb-trail', 'ch01-s02-breadbox-heist', 'ch01-s03-midnight-fridge', 'ch01-s04-sink-island', 'ch01-s05-spice-rack', 'ch01-s06-oven-warmth', 'ch01-s07-dishwasher-hum', 'ch01-s08-gran-returns'],
  ['ch02-s01-wine-rows', 'ch02-s02-coal-chute', 'ch02-s03-root-cellar', 'ch02-s04-furnace-glow', 'ch02-s05-jar-shelf', 'ch02-s06-flooded-sump', 'ch02-s07-rafter-run', 'ch02-s08-locked-hatch'],
  ['ch03-s01-dumpster-row', 'ch03-s02-fire-escape', 'ch03-s03-wet-bricks', 'ch03-s04-neon-puddle', 'ch03-s05-loading-dock', 'ch03-s06-chain-link', 'ch03-s07-stray-circle', 'ch03-s08-rooftop-leap'],
  ['ch04-s01-pipe-crawl', 'ch04-s02-grate-gallery', 'ch04-s03-overflow-gate', 'ch04-s04-echo-tunnel', 'ch04-s05-maintenance-walk', 'ch04-s06-sludge-bend', 'ch04-s07-pump-room', 'ch04-s08-outflow-door'],
  ['ch05-s01-trunk-maze', 'ch05-s02-insulation-sea', 'ch05-s03-dormer-window', 'ch05-s04-hatbox-stack', 'ch05-s05-chimney-nook', 'ch05-s06-loose-board', 'ch05-s07-owl-rafter', 'ch05-s08-widow-walk'],
  ['ch06-s01-ticket-booth', 'ch06-s02-bumper-floor', 'ch06-s03-cotton-stall', 'ch06-s04-hall-of-mirrors', 'ch06-s05-ferris-shadow', 'ch06-s06-ring-toss', 'ch06-s07-funhouse-tilt', 'ch06-s08-prize-tent'],
  ['ch07-s01-marble-foyer', 'ch07-s02-armor-hall', 'ch07-s03-vase-wing', 'ch07-s04-night-watch', 'ch07-s05-fossil-pit', 'ch07-s06-portrait-gaze', 'ch07-s07-skydome', 'ch07-s08-archive-vault'],
  ['ch08-s01-platform-edge', 'ch08-s02-turnstile-jam', 'ch08-s03-bench-row', 'ch08-s04-third-rail', 'ch08-s05-service-tunnel', 'ch08-s06-map-kiosk', 'ch08-s07-lost-and-found', 'ch08-s08-ghost-express'],
  ['ch09-s01-pier-planks', 'ch09-s02-crate-city', 'ch09-s03-net-loft', 'ch09-s04-foghorn-bay', 'ch09-s05-warehouse-aisle', 'ch09-s06-gangway', 'ch09-s07-cold-storage', 'ch09-s08-captain-cabin'],
  ['ch10-s01-seedling-rows', 'ch10-s02-mist-house', 'ch10-s03-potting-bench', 'ch10-s04-orchid-maze', 'ch10-s05-irrigation', 'ch10-s06-compost-heap', 'ch10-s07-glass-ridge', 'ch10-s08-queen-agave'],
  ['ch11-s01-gear-floor', 'ch11-s02-pendulum-well', 'ch11-s03-bell-loft', 'ch11-s04-escapement', 'ch11-s05-winding-stair', 'ch11-s06-counterweight', 'ch11-s07-face-scaffold', 'ch11-s08-midnight-chime'],
  ['ch12-s01-airlock', 'ch12-s02-sample-vault', 'ch12-s03-centrifuge', 'ch12-s04-clean-room', 'ch12-s05-observation', 'ch12-s06-reactor-catwalk', 'ch12-s07-cryo-bay', 'ch12-s08-launch-cradle'],
];

const ARCADE = [
  'arcade-01-heat-market', 'arcade-02-neon-chase', 'arcade-03-pipe-panic', 'arcade-04-crowd-surge',
  'arcade-05-mirror-bowl', 'arcade-06-grate-storm', 'arcade-07-dock-rush', 'arcade-08-bloom-break',
  'arcade-09-bell-sprint', 'arcade-10-lab-leak', 'arcade-11-crumb-riot', 'arcade-12-alley-overflow',
  'arcade-13-attic-draft', 'arcade-14-carnival-spin', 'arcade-15-marble-heat', 'arcade-16-third-rail-jam',
  'arcade-17-fog-pileup', 'arcade-18-orchid-burst', 'arcade-19-gear-flood', 'arcade-20-airlock-wave',
  'arcade-21-double-pounce', 'arcade-22-quota-fever', 'arcade-23-director-max', 'arcade-24-last-kettle',
];

const TIME_ATTACK = [
  'ta-01-sprint-pantry', 'ta-02-cellar-dash', 'ta-03-alley-cut', 'ta-04-pipe-shot',
  'ta-05-rafter-line', 'ta-06-bumper-split', 'ta-07-foyer-blitz', 'ta-08-platform-fly',
  'ta-09-pier-run', 'ta-10-glass-cut', 'ta-11-pendulum-gap', 'ta-12-protocol-go',
];

const TOPO = ['rooms', 'maze', 'islands', 'galleries', 'channels', 'ring', 'dual'];
const WALK = new Set(['.', 'r', 'g', 'v', 'o', '_', 'G', 'p', 's', 'L', '~']);

function grid(w, h, fill = '#') {
  const cells = [];
  for (let y = 0; y < h; y += 1) {
    const row = [];
    for (let x = 0; x < w; x += 1) row.push(fill);
    cells.push(row);
  }
  return { w, h, cells };
}

function inb(g, x, y) {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

function at(g, x, y) {
  return inb(g, x, y) ? g.cells[y][x] : '#';
}

function set(g, x, y, ch) {
  if (inb(g, x, y)) g.cells[y][x] = ch;
}

function fill(g, x, y, w, h, ch) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) set(g, xx, yy, ch);
  }
}

function seal(g) {
  for (let x = 0; x < g.w; x += 1) {
    set(g, x, 0, '#');
    set(g, x, g.h - 1, '#');
  }
  for (let y = 0; y < g.h; y += 1) {
    set(g, 0, y, '#');
    set(g, g.w - 1, y, '#');
  }
}

function carveH(g, x0, x1, y, ch = '.') {
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  for (let x = a; x <= b; x += 1) set(g, x, y, ch);
}

function carveV(g, y0, y1, x, ch = '.') {
  const a = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  for (let y = a; y <= b; y += 1) set(g, x, y, ch);
}

function carveL(g, x0, y0, x1, y1, horiz) {
  if (horiz) {
    carveH(g, x0, x1, y0);
    carveV(g, y0, y1, x1);
  } else {
    carveV(g, y0, y1, x0);
    carveH(g, x0, x1, y1);
  }
}

function rowsOf(g) {
  return g.cells.map((row) => row.join(''));
}

function walkable(g) {
  const spots = [];
  for (let y = 1; y < g.h - 1; y += 1) {
    for (let x = 1; x < g.w - 1; x += 1) {
      if (WALK.has(at(g, x, y))) spots.push({ x, y });
    }
  }
  return spots;
}

function flood(g, sx, sy) {
  const seen = new Set();
  if (!WALK.has(at(g, sx, sy))) return seen;
  const stack = [sx, sy];
  seen.add(sy * g.w + sx);
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const n = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of n) {
      if (!inb(g, nx, ny) || !WALK.has(at(g, nx, ny))) continue;
      const key = ny * g.w + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(nx, ny);
    }
  }
  return seen;
}

function farthest(g, sx, sy) {
  const seen = flood(g, sx, sy);
  let best = { x: sx, y: sy };
  let bestD = -1;
  for (const key of seen) {
    const x = key % g.w;
    const y = Math.floor(key / g.w);
    const d = Math.abs(x - sx) + Math.abs(y - sy);
    if (d > bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

function splitRooms(rng, x, y, w, h, minW, minH, rooms, depth) {
  const canH = w >= minW * 2 + 2;
  const canV = h >= minH * 2 + 2;
  if (depth <= 0 || (!canH && !canV) || rng.bool(0.2)) {
    rooms.push({ x, y, w, h });
    return;
  }
  if (canH && (!canV || rng.bool())) {
    const cut = rng.int(minW, w - minW + 1);
    splitRooms(rng, x, y, cut, h, minW, minH, rooms, depth - 1);
    splitRooms(rng, x + cut, y, w - cut, h, minW, minH, rooms, depth - 1);
  } else {
    const cut = rng.int(minH, h - minH + 1);
    splitRooms(rng, x, y, w, cut, minW, minH, rooms, depth - 1);
    splitRooms(rng, x, y + cut, w, h - cut, minW, minH, rooms, depth - 1);
  }
}

function topoRooms(rng, w, h, kit) {
  const g = grid(w, h);
  const rooms = [];
  splitRooms(rng, 1, 1, w - 2, h - 2, 5, 4, rooms, 4);
  if (!rooms.length) rooms.push({ x: 1, y: 1, w: w - 2, h: h - 2 });
  for (const r of rooms) fill(g, r.x + 1, r.y + 1, Math.max(1, r.w - 2), Math.max(1, r.h - 2), '.');
  rooms.sort((a, b) => a.x + a.y - (b.x + b.y));
  for (let i = 1; i < rooms.length; i += 1) {
    const a = rooms[i - 1];
    const b = rooms[i];
    carveL(g, Math.floor(a.x + a.w / 2), Math.floor(a.y + a.h / 2), Math.floor(b.x + b.w / 2), Math.floor(b.y + b.h / 2), rng.bool());
  }
  scatter(g, rng, kit, 8);
  seal(g);
  return g;
}

function topoIslands(rng, w, h, kit) {
  const g = grid(w, h);
  fill(g, 1, 1, w - 2, h - 2, '.');
  const n = 4 + rng.int(0, 6);
  for (let i = 0; i < n; i += 1) {
    const iw = 2 + rng.int(0, 4);
    const ih = 2 + rng.int(0, 3);
    const x = rng.int(2, w - iw - 2);
    const y = rng.int(2, h - ih - 2);
    fill(g, x, y, iw, ih, rng.pick(kit.clutter));
  }
  scatter(g, rng, kit, 6);
  seal(g);
  return g;
}

function topoGalleries(rng, w, h, kit) {
  const g = grid(w, h);
  const rows = 2 + (h > 14 ? 1 : 0);
  const rowH = Math.floor((h - 2) / rows);
  for (let r = 0; r < rows; r += 1) {
    const y = 1 + r * rowH;
    const hh = r === rows - 1 ? h - 1 - y : Math.max(2, rowH - 1);
    fill(g, 1, y, w - 2, hh, '.');
    const doors = 2 + rng.int(0, 2);
    for (let d = 0; d < doors; d += 1) set(g, 2 + rng.int(0, w - 4), Math.min(h - 2, y + hh), '.');
    for (let x = 3 + (r % 3); x < w - 3; x += 4 + (r % 2)) set(g, x, y + 1, rng.pick(kit.clutter));
  }
  seal(g);
  return g;
}

function topoChannels(rng, w, h, kit) {
  const g = grid(w, h);
  const vertical = rng.bool();
  if (vertical) {
    const count = 3 + rng.int(0, 2);
    const span = Math.floor((w - 2) / count);
    for (let i = 0; i < count; i += 1) {
      const x = 1 + i * span;
      fill(g, x, 1, Math.max(2, span - 1), h - 2, '.');
      if (i > 0) carveH(g, x - 1, x, 2 + rng.int(0, h - 4));
      if (kit.liquid && i === 1) carveV(g, 2, h - 3, x + 1, kit.liquid);
    }
  } else {
    const count = 2 + rng.int(0, 2);
    const span = Math.floor((h - 2) / count);
    for (let i = 0; i < count; i += 1) {
      const y = 1 + i * span;
      fill(g, 1, y, w - 2, Math.max(2, span - 1), '.');
      if (i > 0) carveV(g, y - 1, y, 2 + rng.int(0, w - 4));
    }
  }
  scatter(g, rng, kit, 5);
  seal(g);
  return g;
}

function topoRing(rng, w, h, kit) {
  const g = grid(w, h);
  fill(g, 1, 1, w - 2, h - 2, '.');
  const ix = 3 + rng.int(0, 2);
  const iy = 3 + rng.int(0, 2);
  const iw = Math.max(3, w - ix * 2);
  const ih = Math.max(3, h - iy * 2);
  fill(g, ix, iy, iw, ih, '#');
  set(g, rng.int(ix, ix + iw), iy, '.');
  set(g, rng.int(ix, ix + iw), iy + ih - 1, '.');
  set(g, ix, rng.int(iy, iy + ih), '.');
  if (kit.liquid && iw > 4 && ih > 4) fill(g, ix + 1, iy + 1, iw - 2, ih - 2, kit.liquid);
  scatter(g, rng, kit, 4);
  seal(g);
  return g;
}

function topoDual(rng, w, h, kit) {
  const g = grid(w, h);
  const split = Math.floor(w * (0.38 + rng.next() * 0.24));
  fill(g, 1, 1, split - 2, h - 2, '.');
  fill(g, split + 1, 1, w - split - 2, h - 2, '.');
  const links = 1 + rng.int(0, 2);
  for (let i = 0; i < links; i += 1) carveH(g, split - 2, split + 1, 2 + rng.int(0, h - 4));
  scatter(g, rng, kit, 6);
  seal(g);
  return g;
}

function topoMaze(rng, w, h, kit) {
  const g = grid(w, h);
  const sx = 1 + 2 * rng.int(0, Math.floor((w - 3) / 2));
  const sy = 1 + 2 * rng.int(0, Math.floor((h - 3) / 2));
  set(g, sx, sy, '.');
  const stack = [[sx, sy]];
  const dirs = [[0, -2], [2, 0], [0, 2], [-2, 0]];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
      if (at(g, nx, ny) !== '#') continue;
      opts.push([nx, ny, x + dx / 2, y + dy / 2]);
    }
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, wx, wy] = rng.pick(opts);
    set(g, wx, wy, '.');
    set(g, nx, ny, '.');
    stack.push([nx, ny]);
  }
  for (let i = 0; i < 3 + rng.int(0, 3); i += 1) {
    fill(g, rng.int(2, w - 5), rng.int(2, h - 4), 3 + rng.int(0, 3), 3, '.');
  }
  scatter(g, rng, kit, 10);
  seal(g);
  return g;
}

function scatter(g, rng, kit, n) {
  for (let i = 0; i < n; i += 1) {
    const x = rng.int(2, g.w - 2);
    const y = rng.int(2, g.h - 2);
    if (at(g, x, y) !== '.') continue;
    if (rng.bool(0.5)) set(g, x, y, kit.alt);
    else if (rng.bool(0.45)) set(g, x, y, rng.pick(kit.clutter));
    else if (kit.liquid && rng.bool(0.2)) set(g, x, y, kit.liquid);
  }
}

function signature(g, rng, salt) {
  const x = 2 + (salt % Math.max(1, g.w - 4));
  const y = 2 + ((salt >> 3) % Math.max(1, g.h - 4));
  if (at(g, x, y) === '#') set(g, x, y, '.');
  if (rng.bool()) set(g, Math.min(g.w - 2, x + 1), y, rng.bool() ? 'r' : 'g');
}

function decorRows(g, rng, salt) {
  const marks = [',', '`', '.', ' ', ' ', ' ', '+', '*', '='];
  const rows = [];
  for (let y = 0; y < g.h; y += 1) {
    let row = '';
    for (let x = 0; x < g.w; x += 1) {
      const ch = at(g, x, y);
      if (ch === '#') row += rng.bool(0.07) ? '+' : ' ';
      else if (WALK.has(ch)) row += marks[(x * 17 + y * 31 + salt) % marks.length];
      else row += rng.bool(0.2) ? '=' : ' ';
    }
    rows.push(row);
  }
  return rows;
}

function titleOf(id) {
  const slug = id.split('-').slice(id.startsWith('ch') ? 2 : 2).join(' ') || id;
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

function takeSpot(spots, avoid, minDist) {
  for (let i = 0; i < spots.length; i += 1) {
    const s = spots[i];
    if (avoid.some((a) => Math.abs(a.x - s.x) + Math.abs(a.y - s.y) < minDist)) continue;
    spots.splice(i, 1);
    return s;
  }
  return spots.shift() || null;
}

function buildStage(spec) {
  const { id, chapter, index, theme, kind } = spec;
  const seed = (hashString(id) ^ (chapter * 997 + index * 13)) >>> 0;
  const rng = new Rng(seed);
  const kit = KITS[theme];
  const topo = TOPO[(seed + chapter * 17 + index * 31) % TOPO.length];
  let width = 15 + rng.int(0, 10);
  let height = 11 + rng.int(0, 7);
  if (kind === 'timeAttack') {
    width = 14 + rng.int(0, 5);
    height = 10 + rng.int(0, 3);
  }
  const builders = {
    rooms: topoRooms,
    maze: topoMaze,
    islands: topoIslands,
    galleries: topoGalleries,
    channels: topoChannels,
    ring: topoRing,
    dual: topoDual,
  };
  const g = builders[topo](rng, width, height, kit);
  signature(g, rng, seed);

  const spots0 = walkable(g);
  if (!spots0.length) fill(g, 1, 1, g.w - 2, g.h - 2, '.');
  const spawn = walkable(g)[0] || { x: 2, y: 2 };
  set(g, spawn.x, spawn.y, '.');
  let hole = farthest(g, spawn.x, spawn.y);
  if (hole.x === spawn.x && hole.y === spawn.y) hole = { x: g.w - 3, y: g.h - 3 };
  carveL(g, spawn.x, spawn.y, hole.x, hole.y, rng.bool());
  set(g, hole.x, hole.y, 'o');
  seal(g);

  const quota = spec.quota ?? Math.min(10, (kind === 'timeAttack' ? 3 : 3) + Math.floor(Math.max(0, chapter - 1) / 2) + (index > 5 ? 1 : 0) + (kind === 'arcade' ? 1 : 0));
  const catCount = spec.cats ?? (kind === 'timeAttack' ? 1 : chapter >= 10 ? 2 : chapter >= 7 ? 2 : kind === 'arcade' && index >= 8 ? 2 : 1);
  const cheeseNeed = quota + 1 + rng.int(0, 2);
  const lives = kind === 'timeAttack' ? 2 : chapter >= 11 ? 2 : 3;

  const reserved = [spawn, hole];
  const spots = rng.shuffle(walkable(g).filter((s) => !(s.x === spawn.x && s.y === spawn.y) && !(s.x === hole.x && s.y === hole.y)));

  const entities = [{ type: 'hole', x: hole.x, y: hole.y, id: `${id}-hole` }];
  const cheeses = [];
  for (let i = 0; i < cheeseNeed; i += 1) {
    const spot = takeSpot(spots, reserved, 2);
    if (!spot) break;
    reserved.push(spot);
    carveL(g, spawn.x, spawn.y, spot.x, spot.y, rng.bool());
    cheeses.push(spot);
    entities.push({ type: 'cheese', x: spot.x, y: spot.y, value: 1, guarded: kind === 'story' && rng.bool(0.1 + chapter * 0.02) });
  }
  set(g, hole.x, hole.y, 'o');
  set(g, spawn.x, spawn.y, at(g, spawn.x, spawn.y) === '#' ? '.' : at(g, spawn.x, spawn.y));
  if (!WALK.has(at(g, spawn.x, spawn.y))) set(g, spawn.x, spawn.y, '.');
  seal(g);

  const patrols = [];
  for (let i = 0; i < catCount; i += 1) {
    const spot = takeSpot(spots, [spawn, hole], 4) || farthest(g, spawn.x, spawn.y);
    reserved.push(spot);
    const breed = kit.breeds[(chapter + index + i) % kit.breeds.length];
    const route = [spot];
    for (let p = 0; p < 3; p += 1) {
      const next = takeSpot(spots.slice(), route, 2) || spots[p] || spot;
      route.push(next);
    }
    patrols.push({
      id: i + 1,
      loop: rng.bool(0.7),
      pauseSeconds: Math.round((0.3 + rng.next() * 1.4) * 100) / 100,
      points: route,
    });
    entities.push({ type: 'cat', x: spot.x, y: spot.y, breed, patrol: i + 1, facing: Math.round(rng.next() * Math.PI * 2 * 100) / 100 });
  }

  if (kind !== 'timeAttack' || rng.bool(0.4)) {
    const spot = takeSpot(spots, reserved, 2);
    if (spot) entities.push({ type: 'powerUp', x: spot.x, y: spot.y, kind: rng.pick(kit.power) });
  }
  const hz = kind === 'timeAttack' ? rng.int(0, 2) : rng.int(chapter > 2 ? 1 : 0, 2 + Math.floor(chapter / 5));
  for (let i = 0; i < hz; i += 1) {
    const spot = takeSpot(spots, [spawn, hole], 3);
    if (!spot) break;
    entities.push({ type: 'hazard', x: spot.x, y: spot.y, kind: rng.pick(kit.hazards) });
  }
  if (chapter >= 4 && rng.bool(0.4)) {
    const keySpot = takeSpot(spots, reserved, 2);
    const doorSpot = takeSpot(spots, reserved, 2);
    if (keySpot && doorSpot) {
      const keyId = `${id}-key`;
      entities.push({ type: 'key', x: keySpot.x, y: keySpot.y, keyId });
      entities.push({ type: 'door', x: doorSpot.x, y: doorSpot.y, id: `${id}-door`, locked: true, keyId });
      set(g, doorSpot.x, doorSpot.y, 'D');
    }
  }
  if (rng.bool(0.55)) {
    const prop = takeSpot(spots, reserved, 1);
    if (prop) entities.push({ type: 'decorProp', x: prop.x, y: prop.y, note: rng.pick(kit.landmarks) });
  }

  const lights = [];
  for (let i = 0; i < 2 + rng.int(0, 3); i += 1) {
    const spot = spots[i * 2] || spawn;
    lights.push({
      x: spot.x,
      y: spot.y,
      radius: Math.round((3.2 + rng.next() * 3) * 10) / 10,
      intensity: Math.round((0.4 + rng.next() * 0.5) * 100) / 100,
      flicker: rng.bool(0.3) ? Math.round((0.1 + rng.next() * 0.25) * 100) / 100 : 0,
      on: true,
    });
  }
  lights.push({ x: hole.x, y: hole.y, radius: 2.2, intensity: 0.75, color: '#d4f0a0', on: true });

  const landmark = rng.pick(kit.landmarks);
  const slug = titleOf(id);
  const dialogue = [
    { at: 'enter', speaker: 'Narrator', line: `${slug}. The ${landmark} keeps a second set of books.` },
    { at: 'enter', speaker: 'Squeak', line: `Quota ${quota}. ${catCount === 1 ? 'One hunter' : catCount + ' hunters'}. Hole at the far ${hole.y < spawn.y ? 'north' : 'south'}.`, delay: 0.4 },
    { at: 'enter', speaker: rng.bool() ? 'Gran' : 'Radio', line: `Sneak the ${landmark}. Dash is postage. The ${topo} layout lies about shortcuts.`, delay: 0.9 },
    { at: 'firstCheese', speaker: 'Squeak', line: `Wedge by the ${landmark}. Heavy. Mine until the hole says otherwise.` },
    { at: 'firstSpotted', speaker: 'Pounce', line: `I heard a verb in ${theme}. Verbs are edible.` },
    { at: 'halfQuota', speaker: 'Radio', line: `Half of ${quota}. ${topo} heat is ${kind === 'arcade' ? 'a kettle' : 'a weather'}.` },
    { at: 'lowLives', speaker: 'Gran', line: 'You dashed in a cone. That is not bravery.' },
    { at: 'win', speaker: 'Squeak', line: `${slug} banked. Whiskers attached.` },
    { at: 'lose', speaker: 'Pounce', line: `The ${landmark} keeps what you could not.` },
    { at: 'idle', speaker: 'Narrator', line: `A board near the ${landmark} considers creaking.`, delay: 8 },
  ];

  const parTime = Math.round((kind === 'timeAttack' ? 40 : 55) + g.w * g.h * 0.1 + quota * 8 + catCount * 7);
  const objectives = [{ kind: 'quota', value: quota, optional: false, label: `Bank ${quota} cheese` }];
  if (kind === 'timeAttack') objectives.push({ kind: 'timeLimit', value: parTime, optional: false, label: `Beat ${parTime}s` });
  else objectives.push({ kind: 'noCatch', value: 1, optional: true, label: 'Ghost clear' });

  const tiles = rowsOf(g);
  const decor = decorRows(g, rng, seed);
  if (tiles.some((row) => row.length !== g.w) || tiles.length !== g.h) {
    throw new Error(`bad tiles ${id}`);
  }

  return {
    id,
    chapter: kind === 'story' ? chapter : 0,
    index,
    name: slug,
    theme,
    kind,
    seed,
    width: g.w,
    height: g.h,
    tileSize: 16,
    tiles,
    decor,
    spawn,
    entities,
    lights,
    patrols,
    dialogue,
    hints: {
      ambushSpots: [{ x: hole.x, y: Math.max(1, hole.y - 1) }, cheeses[0] || hole],
      searchSpots: cheeses.slice(0, 4),
      aggression: Math.round((0.4 + chapter * 0.05 + (kind === 'arcade' ? 0.2 : 0) + rng.next() * 0.15) * 100) / 100,
      scentBias: Math.round((0.35 + rng.next() * 0.5) * 100) / 100,
      hearingBias: Math.round((0.35 + rng.next() * 0.5) * 100) / 100,
      campHoleChance: Math.round((0.06 + (catCount > 1 ? 0.1 : 0) + rng.next() * 0.15) * 100) / 100,
      leashRadius: 6 + chapter + (kind === 'arcade' ? 4 : 0),
    },
    objectives,
    quota,
    parTime,
    lives,
    ambient: kit.ambient,
    difficulty: Math.round(Math.min(10, 1 + Math.max(0, chapter - 1) * 0.7 + index * 0.12 + (kind === 'arcade' ? 2 : 0)) * 10) / 10,
    music: kit.music,
    tags: [theme, topo, kind, catCount > 1 ? 'multi-cat' : 'solo-cat', `q${quota}`],
  };
}

function ident(id) {
  const raw = id.replace(/[^a-zA-Z0-9]+/g, '_');
  return /^[A-Za-z]/.test(raw) ? raw : `s_${raw}`;
}

function emit(stage) {
  return `import type { StageDef } from '../../schema';\n\nconst stage: StageDef = ${JSON.stringify(stage, null, 2)};\n\nexport default stage;\n`;
}

function writeStage(dir, stage) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stage.id}.ts`);
  if (existsSync(file)) return false;
  writeFileSync(file, emit(stage));
  return true;
}

function listStages() {
  const jobs = [];
  for (let c = 0; c < STORY.length; c += 1) {
    const theme = THEMES[c];
    for (let i = 0; i < STORY[c].length; i += 1) {
      jobs.push({ id: STORY[c][i], chapter: c + 1, index: i + 1, theme, kind: 'story', dir: join(content, 'stages', 'story') });
    }
  }
  for (let i = 0; i < ARCADE.length; i += 1) {
    jobs.push({ id: ARCADE[i], chapter: 0, index: i + 1, theme: THEMES[i % THEMES.length], kind: 'arcade', dir: join(content, 'stages', 'arcade') });
  }
  for (let i = 0; i < TIME_ATTACK.length; i += 1) {
    jobs.push({ id: TIME_ATTACK[i], chapter: 0, index: i + 1, theme: THEMES[i % THEMES.length], kind: 'timeAttack', dir: join(content, 'stages', 'timeAttack') });
  }
  return jobs;
}

function writeRegistry(files) {
  const imports = [];
  const names = [];
  for (const file of files) {
    const id = file.replace(/\.ts$/, '');
    const folder = file.includes('/arcade/') || file.startsWith('arcade') ? 'arcade' : file.includes('timeAttack') || file.startsWith('ta-') ? 'timeAttack' : 'story';
    const base = id.split('/').pop();
    const name = ident(base);
    imports.push(`import ${name} from './stages/${folder}/${base}';`);
    names.push(name);
  }
  const src = `import type { StageDef } from './schema';
${imports.join('\n')}

export const STAGES: readonly StageDef[] = [
  ${names.join(',\n  ')},
];

export const STAGES_BY_ID: Readonly<Record<string, StageDef>> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage]),
);

export function stageById(id: string): StageDef | undefined {
  return STAGES_BY_ID[id];
}

export const STORY_STAGES = STAGES.filter((stage) => stage.kind === 'story');
export const ARCADE_STAGES = STAGES.filter((stage) => stage.kind === 'arcade');
export const TIME_ATTACK_STAGES = STAGES.filter((stage) => stage.kind === 'timeAttack');

export function findStage(chapter: number, index: number): StageDef | undefined {
  return STORY_STAGES.find((stage) => stage.chapter === chapter && stage.index === index);
}

export function stagesOfChapter(chapter: number): readonly StageDef[] {
  return STORY_STAGES.filter((stage) => stage.chapter === chapter);
}

export function lastAuthoredChapter(): number {
  let max = 0;
  for (const stage of STORY_STAGES) {
    if (stage.chapter > max) max = stage.chapter;
  }
  return max;
}
`;
  writeFileSync(join(content, 'registry.ts'), src);
}

const jobs = listStages();
let written = 0;
let skipped = 0;
for (const job of jobs) {
  const file = join(job.dir, `${job.id}.ts`);
  if (existsSync(file)) {
    skipped += 1;
    continue;
  }
  const stage = buildStage(job);
  if (writeStage(job.dir, stage)) written += 1;
}

const storyFiles = readdirSync(join(content, 'stages', 'story')).filter((f) => f.endsWith('.ts')).sort().map((f) => `story/${f}`);
const arcadeFiles = readdirSync(join(content, 'stages', 'arcade')).filter((f) => f.endsWith('.ts')).sort().map((f) => `arcade/${f}`);
const taFiles = readdirSync(join(content, 'stages', 'timeAttack')).filter((f) => f.endsWith('.ts')).sort().map((f) => `timeAttack/${f}`);
writeRegistry([...storyFiles, ...arcadeFiles, ...taFiles]);

console.log(`gen-stages: wrote ${written}, skipped ${skipped}, registry ${storyFiles.length + arcadeFiles.length + taFiles.length} stages`);
