import { octile } from './math';
import type { FlowFieldLike, GridPoint, PathRequest, PathResult, TileMapLike, Vec2 } from './types';

const SQRT2 = Math.SQRT2;

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  px: number;
  py: number;
}

class MinHeap {
  private readonly data: Node[] = [];

  get size(): number {
    return this.data.length;
  }

  push(node: Node): void {
    this.data.push(node);
    this.up(this.data.length - 1);
  }

  pop(): Node | undefined {
    const first = this.data[0];
    const last = this.data.pop();
    if (last === undefined) return undefined;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.down(0);
    }
    return first;
  }

  private up(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i]!.f >= this.data[parent]!.f) break;
      const tmp = this.data[i]!;
      this.data[i] = this.data[parent]!;
      this.data[parent] = tmp;
      i = parent;
    }
  }

  private down(index: number): void {
    const n = this.data.length;
    let i = index;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.data[left]!.f < this.data[smallest]!.f) smallest = left;
      if (right < n && this.data[right]!.f < this.data[smallest]!.f) smallest = right;
      if (smallest === i) break;
      const tmp = this.data[i]!;
      this.data[i] = this.data[smallest]!;
      this.data[smallest] = tmp;
      i = smallest;
    }
  }
}

function pack(x: number, y: number): number {
  return ((y + 32768) << 16) | ((x + 32768) & 0xffff);
}

function walkable(map: TileMapLike, x: number, y: number, allowMouseOnly: boolean): boolean {
  if (!map.inBounds(x, y)) return false;
  const p = map.props(x, y);
  if (!Number.isFinite(p.cost) || p.cost === Infinity) return false;
  if (p.solid) return false;
  if (p.mouseOnly && !allowMouseOnly) return false;
  return true;
}

function tileCost(map: TileMapLike, x: number, y: number, allowMouseOnly: boolean): number {
  if (!walkable(map, x, y, allowMouseOnly)) return Infinity;
  return map.props(x, y).cost;
}

const ORTHO: readonly GridPoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIAG: readonly { x: number; y: number; ax: number; ay: number; bx: number; by: number }[] = [
  { x: 1, y: 1, ax: 1, ay: 0, bx: 0, by: 1 },
  { x: 1, y: -1, ax: 1, ay: 0, bx: 0, by: -1 },
  { x: -1, y: 1, ax: -1, ay: 0, bx: 0, by: 1 },
  { x: -1, y: -1, ax: -1, ay: 0, bx: 0, by: -1 },
];

export function neighborsOf(
  map: TileMapLike,
  x: number,
  y: number,
  allowMouseOnly: boolean,
  diagonal = true,
): { x: number; y: number; cost: number }[] {
  const out: { x: number; y: number; cost: number }[] = [];
  const here = tileCost(map, x, y, allowMouseOnly);
  for (let i = 0; i < ORTHO.length; i += 1) {
    const d = ORTHO[i]!;
    const nx = x + d.x;
    const ny = y + d.y;
    const c = tileCost(map, nx, ny, allowMouseOnly);
    if (!Number.isFinite(c)) continue;
    out.push({ x: nx, y: ny, cost: (here + c) * 0.5 });
  }
  if (!diagonal) return out;
  for (let i = 0; i < DIAG.length; i += 1) {
    const d = DIAG[i]!;
    const nx = x + d.x;
    const ny = y + d.y;
    const c = tileCost(map, nx, ny, allowMouseOnly);
    if (!Number.isFinite(c)) continue;
    if (!walkable(map, x + d.ax, y + d.ay, allowMouseOnly)) continue;
    if (!walkable(map, x + d.bx, y + d.by, allowMouseOnly)) continue;
    out.push({ x: nx, y: ny, cost: ((here + c) * 0.5) * SQRT2 });
  }
  return out;
}

function reconstruct(came: Map<number, Node>, end: Node): GridPoint[] {
  const path: GridPoint[] = [];
  let current: Node | undefined = end;
  const guard = 1 << 20;
  let steps = 0;
  while (current && steps < guard) {
    path.push({ x: current.x, y: current.y });
    if (current.px === current.x && current.py === current.y) break;
    current = came.get(pack(current.px, current.py));
    steps += 1;
  }
  path.reverse();
  return path;
}

function pathCost(map: TileMapLike, nodes: GridPoint[], allowMouseOnly: boolean): number {
  if (nodes.length === 0) return 0;
  let total = 0;
  for (let i = 1; i < nodes.length; i += 1) {
    const a = nodes[i - 1]!;
    const b = nodes[i]!;
    const step = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 2 ? SQRT2 : 1;
    const c = tileCost(map, b.x, b.y, allowMouseOnly);
    total += step * (Number.isFinite(c) ? c : 1);
  }
  return total;
}

export function findPath(map: TileMapLike, request: PathRequest): PathResult {
  const allow = request.allowMouseOnly !== false;
  const weight = request.heuristicWeight ?? 1;
  const maxNodes = request.maxNodes ?? map.width * map.height;
  const start = request.start;
  const goal = request.goal;

  if (!map.inBounds(start.x, start.y) || !map.inBounds(goal.x, goal.y)) {
    return { found: false, nodes: [], cost: Infinity, expanded: 0 };
  }
  if (!walkable(map, start.x, start.y, allow) || !walkable(map, goal.x, goal.y, allow)) {
    return { found: false, nodes: [], cost: Infinity, expanded: 0 };
  }
  if (start.x === goal.x && start.y === goal.y) {
    return { found: true, nodes: [{ x: start.x, y: start.y }], cost: 0, expanded: 1 };
  }

  const open = new MinHeap();
  const came = new Map<number, Node>();
  const bestG = new Map<number, number>();
  const startNode: Node = {
    x: start.x,
    y: start.y,
    g: 0,
    f: octile(start.x, start.y, goal.x, goal.y) * weight,
    px: start.x,
    py: start.y,
  };
  open.push(startNode);
  came.set(pack(start.x, start.y), startNode);
  bestG.set(pack(start.x, start.y), 0);

  let expanded = 0;
  while (open.size > 0 && expanded < maxNodes) {
    const current = open.pop() as Node;
    const currentKey = pack(current.x, current.y);
    const known = bestG.get(currentKey);
    if (known !== undefined && current.g > known + 1e-9) continue;
    expanded += 1;
    if (current.x === goal.x && current.y === goal.y) {
      const nodes = reconstruct(came, current);
      return { found: true, nodes, cost: pathCost(map, nodes, allow), expanded };
    }
    const neighbors = neighborsOf(map, current.x, current.y, allow, true);
    for (let i = 0; i < neighbors.length; i += 1) {
      const n = neighbors[i]!;
      const g = current.g + n.cost;
      const key = pack(n.x, n.y);
      const prev = bestG.get(key);
      if (prev !== undefined && g >= prev - 1e-9) continue;
      bestG.set(key, g);
      const node: Node = {
        x: n.x,
        y: n.y,
        g,
        f: g + octile(n.x, n.y, goal.x, goal.y) * weight,
        px: current.x,
        py: current.y,
      };
      came.set(key, node);
      open.push(node);
    }
  }

  return { found: false, nodes: [], cost: Infinity, expanded };
}

/** Removes intermediate waypoints that still have line-of-sight. */
export function smoothPath(map: TileMapLike, nodes: GridPoint[], allowMouseOnly = true): GridPoint[] {
  if (nodes.length <= 2) return nodes.slice();
  const out: GridPoint[] = [nodes[0]!];
  let i = 0;
  while (i < nodes.length - 1) {
    let best = i + 1;
    for (let j = nodes.length - 1; j > i + 1; j -= 1) {
      if (gridLineClear(map, nodes[i]!, nodes[j]!, allowMouseOnly)) {
        best = j;
        break;
      }
    }
    out.push(nodes[best]!);
    i = best;
  }
  return out;
}

export function gridLineClear(
  map: TileMapLike,
  a: GridPoint,
  b: GridPoint,
  allowMouseOnly = true,
): boolean {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  let guard = dx + dy + 2;
  while (guard-- > 0) {
    if (!walkable(map, x, y, allowMouseOnly)) return false;
    if (x === b.x && y === b.y) return true;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

export function pathToWorld(nodes: readonly GridPoint[], tileSize: number): Vec2[] {
  return nodes.map((n) => ({ x: (n.x + 0.5) * tileSize, y: (n.y + 0.5) * tileSize }));
}

export class Pathfinder {
  constructor(
    private readonly map: TileMapLike,
    private readonly defaults: Partial<PathRequest> = {},
  ) {}

  find(start: GridPoint, goal: GridPoint, extra: Partial<PathRequest> = {}): PathResult {
    return findPath(this.map, {
      start,
      goal,
      allowMouseOnly: extra.allowMouseOnly ?? this.defaults.allowMouseOnly,
      maxNodes: extra.maxNodes ?? this.defaults.maxNodes,
      heuristicWeight: extra.heuristicWeight ?? this.defaults.heuristicWeight,
    });
  }
}

/**
 * Dijkstra flood from one or more goals. `direction` points downhill toward
 * the nearest goal; `cost` is integrated travel cost (Infinity if unreachable).
 */
export class FlowField implements FlowFieldLike {
  readonly width: number;
  readonly height: number;
  private readonly integration: Float64Array;
  private readonly dirX: Float32Array;
  private readonly dirY: Float32Array;

  private constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.integration = new Float64Array(n);
    this.dirX = new Float32Array(n);
    this.dirY = new Float32Array(n);
    this.integration.fill(Infinity);
  }

  static fromGoals(
    map: TileMapLike,
    goals: readonly GridPoint[],
    allowMouseOnly = false,
  ): FlowField {
    const field = new FlowField(map.width, map.height);
    field.build(map, goals, allowMouseOnly);
    return field;
  }

  cost(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return Infinity;
    return this.integration[y * this.width + x] as number;
  }

  direction(x: number, y: number): Vec2 {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return { x: 0, y: 0 };
    const i = y * this.width + x;
    return { x: this.dirX[i] as number, y: this.dirY[i] as number };
  }

  private build(map: TileMapLike, goals: readonly GridPoint[], allowMouseOnly: boolean): void {
    const open = new FlowHeap();
    for (const goal of goals) {
      if (!walkable(map, goal.x, goal.y, allowMouseOnly)) continue;
      const i = goal.y * this.width + goal.x;
      this.integration[i] = 0;
      open.push(goal.x, goal.y, 0);
    }

    while (open.size > 0) {
      const current = open.pop()!;
      const currentCost = this.integration[current.y * this.width + current.x] as number;
      if (current.g > currentCost + 1e-9) continue;
      const neighbors = neighborsOf(map, current.x, current.y, allowMouseOnly, true);
      for (let n = 0; n < neighbors.length; n += 1) {
        const nb = neighbors[n]!;
        const next = currentCost + nb.cost;
        const i = nb.y * this.width + nb.x;
        if (next + 1e-9 < (this.integration[i] as number)) {
          this.integration[i] = next;
          open.push(nb.x, nb.y, next);
        }
      }
    }

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const i = y * this.width + x;
        if (!Number.isFinite(this.integration[i] as number)) {
          this.dirX[i] = 0;
          this.dirY[i] = 0;
          continue;
        }
        let bestX = 0;
        let bestY = 0;
        let best = this.integration[i] as number;
        const neighbors = neighborsOf(map, x, y, allowMouseOnly, true);
        for (let n = 0; n < neighbors.length; n += 1) {
          const nb = neighbors[n]!;
          const c = this.cost(nb.x, nb.y);
          if (c < best) {
            best = c;
            bestX = nb.x - x;
            bestY = nb.y - y;
          }
        }
        const len = Math.hypot(bestX, bestY);
        if (len > 0) {
          this.dirX[i] = bestX / len;
          this.dirY[i] = bestY / len;
        } else {
          this.dirX[i] = 0;
          this.dirY[i] = 0;
        }
      }
    }
  }
}

class FlowHeap {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly gs: number[] = [];

  get size(): number {
    return this.xs.length;
  }

  push(x: number, y: number, g: number): void {
    this.xs.push(x);
    this.ys.push(y);
    this.gs.push(g);
    this.up(this.xs.length - 1);
  }

  pop(): { x: number; y: number; g: number } | undefined {
    if (this.xs.length === 0) return undefined;
    const out = { x: this.xs[0]!, y: this.ys[0]!, g: this.gs[0]! };
    const last = this.xs.length - 1;
    this.xs[0] = this.xs[last]!;
    this.ys[0] = this.ys[last]!;
    this.gs[0] = this.gs[last]!;
    this.xs.pop();
    this.ys.pop();
    this.gs.pop();
    if (this.xs.length > 0) this.down(0);
    return out;
  }

  private up(index: number): void {
    let i = index;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.gs[i]! >= this.gs[p]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  private down(index: number): void {
    const n = this.xs.length;
    let i = index;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < n && this.gs[l]! < this.gs[s]!) s = l;
      if (r < n && this.gs[r]! < this.gs[s]!) s = r;
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
  }

  private swap(i: number, j: number): void {
    const x = this.xs[i]!;
    this.xs[i] = this.xs[j]!;
    this.xs[j] = x;
    const y = this.ys[i]!;
    this.ys[i] = this.ys[j]!;
    this.ys[j] = y;
    const g = this.gs[i]!;
    this.gs[i] = this.gs[j]!;
    this.gs[j] = g;
  }
}
