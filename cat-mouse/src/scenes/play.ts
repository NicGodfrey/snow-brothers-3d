import { PALETTE_BY_ID } from '../content/palettes';
import { TILE_LEGEND, type StageDef, type TileGlyph } from '../content/schema';
import type { Camera, InputSnapshot, RendererLike, Scene, SceneContext, TileKind } from '../engine/types';
import type { CatState, StageResult } from '../game/types';
import type { App, SimulationHandle } from '../app';

const SOLID: ReadonlySet<TileKind> = new Set(['void', 'wall', 'crate', 'table', 'glass']);
const MOUSE_ONLY: ReadonlySet<TileKind> = new Set(['vent', 'hole', 'pipe', 'ledge']);

const TILE_FILL: Record<TileKind, string> = {
  void: '#0a0808',
  floor: '#3a2e24',
  wall: '#1a1410',
  crate: '#8a5a32',
  table: '#6b4423',
  water: '#2a4a5a',
  grate: '#3a3a38',
  vent: '#4a4840',
  hole: '#0d0a08',
  door: '#5a3a28',
  oneWay: '#4a4030',
  rug: '#6a3030',
  glass: '#4a6068',
  pipe: '#5a5a50',
  stairs: '#4a4038',
  ledge: '#3a3028',
};

const TILE_ALT: Partial<Record<TileKind, string>> = {
  floor: '#32261e',
};

function tileColor(stage: StageDef, kind: TileKind, tx: number, ty: number): string {
  const pal = PALETTE_BY_ID[stage.theme];
  if (pal) {
    if (kind === 'floor' || kind === 'rug') return (tx + ty) % 2 === 0 ? pal.floor : pal.floorAlt;
    if (kind === 'wall') return pal.wallShade;
    if (kind === 'crate' || kind === 'table' || kind === 'door') return pal.prop;
    if (kind === 'water') return pal.liquid;
    if (kind === 'void' || kind === 'hole') return pal.fog;
    if (kind === 'glass') return pal.light;
  }
  const alt = TILE_ALT[kind];
  return alt && (tx + ty) % 2 === 0 ? alt : TILE_FILL[kind];
}

interface Actor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Pickup {
  x: number;
  y: number;
  value: number;
  taken: boolean;
}

/** Live hunt: tiles from a StageDef, mouse circle, cat rect, input, optional simulation.step. */
export class PlayScene implements Scene {
  readonly name = 'play';
  private readonly app: App;
  private readonly stage: StageDef;
  private simulation: SimulationHandle | null;
  private readonly mouse: Actor;
  private readonly cat: Actor;
  private catState: CatState = 'patrol';
  private patrolIndex = 0;
  private stamina: number;
  private dashTimer = 0;
  private dashCooldown = 0;
  private invulnerable = 0;
  private lives: number;
  private cheeseBanked = 0;
  private quota: number;
  private cheeseCarried = 0;
  private heat = 0;
  private timeSeconds = 0;
  private catches = 0;
  private ended = false;
  private pickups: Pickup[] = [];
  private hole = { x: 0, y: 0 };
  private readyAt = 0;

  constructor(app: App, stage: StageDef, simulation: SimulationHandle | null) {
    this.app = app;
    this.stage = stage;
    this.simulation = simulation;
    const spawn = worldOf(stage, stage.spawn.x, stage.spawn.y);
    this.mouse = { x: spawn.x, y: spawn.y, vx: 0, vy: 0, radius: 10 };
    const catSpawn = stage.entities.find((e) => e.type === 'cat');
    const catPos = catSpawn ? worldOf(stage, catSpawn.x, catSpawn.y) : { x: spawn.x + 200, y: spawn.y };
    this.cat = { x: catPos.x, y: catPos.y, vx: 0, vy: 0, radius: 14 };
    this.lives = stage.lives;
    this.quota = Math.max(0, stage.quota);
    this.stamina = 100;
    this.pickups = stage.entities
      .filter((e) => e.type === 'cheese')
      .map((e) => {
        const p = worldOf(stage, e.x, e.y);
        return { x: p.x, y: p.y, value: e.value ?? 1, taken: false };
      });
    const hole = stage.entities.find((e) => e.type === 'hole') ?? { x: stage.spawn.x, y: stage.spawn.y };
    this.hole = worldOf(stage, hole.x, hole.y);
  }

  enter(ctx: SceneContext): void {
    this.readyAt = ctx.clock.elapsed + 0.12;
    this.app.overlay.showHud();
    const beat = this.stage.dialogue.find((d) => d.at === 'enter');
    this.app.overlay.setBanner(beat ? `${beat.speaker}: ${beat.line}` : this.stage.name);
    window.setTimeout(() => this.app.overlay.setBanner(null), 2800);
    this.syncHud();
    ctx.audio.setListener(this.mouse.x, this.mouse.y);
  }

  pause(): void {
    const raw = this.simulation?.raw as { paused?: boolean } | undefined;
    if (raw) raw.paused = true;
  }

  resume(): void {
    const raw = this.simulation?.raw as { paused?: boolean } | undefined;
    if (raw) raw.paused = false;
    this.app.overlay.showHud();
    this.app.overlay.clearMenu();
  }

  exit(): void {
    this.app.overlay.setBanner(null);
  }

  update(ctx: SceneContext, step: number): void {
    if (this.ended) return;
    if (ctx.clock.elapsed >= this.readyAt && ctx.input.pressed('pause')) {
      this.app.goPause();
      return;
    }

    if (this.simulation) {
      try {
        this.simulation.step(step, ctx.input);
        this.pullSimulation();
      } catch {
        this.simulation = null;
        this.stepLocal(ctx.input, step);
      }
    } else {
      this.stepLocal(ctx.input, step);
    }

    this.timeSeconds += step;
    this.syncHud();
    this.checkOutcome();
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    const camera = cameraFor(this.stage, width, height, this.mouse.x, this.mouse.y, this.app.settings.screenShake ? this.heat * 0.15 : 0);
    renderer.begin(camera);
    renderer.clear('#120e0b');
    drawTiles(renderer, this.stage);
    drawEntities(renderer, this.stage, this.pickups, this.hole);
    renderer.circle(this.mouse.x, this.mouse.y, this.mouse.radius, this.invulnerable > 0 ? '#fff4d8' : '#d8d2c4');
    renderer.rect(this.cat.x - 14, this.cat.y - 12, 28, 24, catColor(this.catState));
    for (const light of this.stage.lights) {
      const p = worldOf(this.stage, light.x, light.y);
      const radius = light.radius <= this.stage.width + 2 ? light.radius * this.stage.tileSize : light.radius;
      renderer.light({
        x: p.x,
        y: p.y,
        radius,
        intensity: light.intensity,
        color: light.color ?? '#ffc070',
      });
    }
    renderer.end();
  }

  private stepLocal(input: InputSnapshot, step: number): void {
    const sneak = input.down('sneak');
    if (this.dashCooldown > 0) this.dashCooldown -= step;
    if (this.dashTimer > 0) this.dashTimer -= step;
    if (this.invulnerable > 0) this.invulnerable -= step;
    this.stamina = Math.min(100, this.stamina + 28 * step);

    if (input.pressed('dash') && this.dashCooldown <= 0 && this.stamina >= 28) {
      this.dashTimer = 0.18;
      this.dashCooldown = 0.55;
      this.stamina -= 28;
    }

    const speed = this.dashTimer > 0 ? 280 : sneak ? 70 : 140;
    const moved = moveAgainstTiles(
      this.stage,
      this.mouse.x,
      this.mouse.y,
      this.mouse.radius,
      input.axisX * speed * step,
      input.axisY * speed * step,
      true,
    );
    this.mouse.x = moved.x;
    this.mouse.y = moved.y;

    for (const cheese of this.pickups) {
      if (cheese.taken) continue;
      if (Math.hypot(cheese.x - this.mouse.x, cheese.y - this.mouse.y) < 16) {
        cheese.taken = true;
        this.cheeseCarried += cheese.value;
      }
    }

    if (input.pressed('interact') && this.cheeseCarried > 0) {
      if (Math.hypot(this.hole.x - this.mouse.x, this.hole.y - this.mouse.y) < 28) {
        this.cheeseBanked += this.cheeseCarried;
        this.cheeseCarried = 0;
      }
    }

    this.stepCat(step, sneak);
    const catchRange = this.mouse.radius + this.cat.radius - 2;
    if (this.invulnerable <= 0 && Math.hypot(this.cat.x - this.mouse.x, this.cat.y - this.mouse.y) < catchRange) {
      this.lives -= 1;
      this.catches += 1;
      this.invulnerable = 1.5;
      const spawn = worldOf(this.stage, this.stage.spawn.x, this.stage.spawn.y);
      this.mouse.x = spawn.x;
      this.mouse.y = spawn.y;
    }
  }

  private stepCat(step: number, sneak: boolean): void {
    const dx = this.mouse.x - this.cat.x;
    const dy = this.mouse.y - this.cat.y;
    const dist = Math.hypot(dx, dy);
    const sight = sneak ? 110 : 190;
    const patrol = this.stage.patrols[0];
    if (dist < sight) {
      this.catState = dist < 48 ? 'pounce' : 'chase';
      this.heat = Math.min(1, this.heat + step * 0.35);
      const speed = this.catState === 'pounce' ? 170 : 125;
      const nx = this.cat.x + (dx / Math.max(dist, 0.01)) * speed * step;
      const ny = this.cat.y + (dy / Math.max(dist, 0.01)) * speed * step;
      const moved = moveAgainstTiles(this.stage, nx, ny, this.cat.radius, 0, 0, false);
      const slide = moveAgainstTiles(this.stage, this.cat.x, this.cat.y, this.cat.radius, nx - this.cat.x, ny - this.cat.y, false);
      this.cat.x = slide.x;
      this.cat.y = slide.y;
      void moved;
      return;
    }
    this.heat = Math.max(0, this.heat - step * 0.2);
    this.catState = 'patrol';
    if (!patrol || patrol.points.length === 0) return;
    const point = patrol.points[this.patrolIndex % patrol.points.length];
    const target = worldOf(this.stage, point.x, point.y);
    const tdx = target.x - this.cat.x;
    const tdy = target.y - this.cat.y;
    const td = Math.hypot(tdx, tdy);
    if (td < 10) this.patrolIndex += 1;
    else {
      const slide = moveAgainstTiles(
        this.stage,
        this.cat.x,
        this.cat.y,
        this.cat.radius,
        (tdx / td) * 70 * step,
        (tdy / td) * 70 * step,
        false,
      );
      this.cat.x = slide.x;
      this.cat.y = slide.y;
    }
  }

  private pullSimulation(): void {
    const raw = this.simulation?.raw;
    if (!raw) return;
    const bag = asRecord(raw.stage) ?? raw;
    const mouse = firstRecord(bag, ['mouse', 'mouseRuntime']) ?? firstRecord(raw, ['mouse', 'mouseRuntime']);
    const cat =
      firstRecord(bag, ['cat', 'catRuntime']) ??
      firstArrayItem(bag, ['cats', 'catRuntimes']) ??
      firstRecord(raw, ['cat', 'catRuntime']) ??
      firstArrayItem(raw, ['cats', 'catRuntimes']);
    const score = firstRecord(bag, ['score', 'scoreState']) ?? firstRecord(raw, ['score', 'scoreState']);
    if (mouse) {
      const t = (mouse.transform as Actor | undefined) ?? mouse;
      if (typeof t.x === 'number' && typeof t.y === 'number') {
        const p = simPoint(this.stage, t.x, t.y);
        this.mouse.x = p.x;
        this.mouse.y = p.y;
      }
      if (typeof t.radius === 'number' && typeof t.x === 'number') {
        this.mouse.radius = simLength(this.stage, t.x, t.radius);
      }
      if (typeof mouse.stamina === 'number') this.stamina = mouse.stamina;
      if (typeof mouse.lives === 'number') this.lives = mouse.lives;
      if (typeof mouse.carrying === 'number') this.cheeseCarried = mouse.carrying;
    }
    if (cat) {
      const t = (cat.transform as Actor | undefined) ?? cat;
      if (typeof t.x === 'number' && typeof t.y === 'number') {
        const p = simPoint(this.stage, t.x, t.y);
        this.cat.x = p.x;
        this.cat.y = p.y;
      }
      if (typeof cat.state === 'string') this.catState = cat.state as CatState;
    }
    const cheeses = bag.cheeses ?? raw.cheeses;
    if (Array.isArray(cheeses)) {
      this.pickups = cheeses.map((item) => {
        const rec = item as Record<string, unknown>;
        const p = simPoint(this.stage, Number(rec.x), Number(rec.y));
        return { x: p.x, y: p.y, value: Number(rec.value ?? 1), taken: Boolean(rec.taken) };
      });
    }
    if (score) {
      if (typeof score.cheeseBanked === 'number') this.cheeseBanked = score.cheeseBanked;
      if (typeof score.cheeseCarried === 'number') this.cheeseCarried = score.cheeseCarried;
      if (typeof score.quota === 'number' && score.quota > 0) this.quota = score.quota;
      if (typeof score.heat === 'number') this.heat = score.heat;
      if (typeof score.timeSeconds === 'number') this.timeSeconds = score.timeSeconds;
      if (typeof score.catches === 'number') this.catches = score.catches;
    }
  }

  private syncHud(): void {
    this.app.hud.update({
      lives: this.lives,
      livesMax: this.stage.lives,
      cheeseBanked: this.cheeseBanked,
      quota: this.quota > 0 ? this.quota : this.stage.quota,
      cheeseCarried: this.cheeseCarried,
      stamina: this.stamina,
      staminaMax: staminaMaxOf(this.simulation?.raw) ?? 100,
      heat: this.heat,
      catState: this.catState,
      stageName: this.stage.name,
    });
  }

  private checkOutcome(): void {
    const raw = this.simulation?.raw;
    const loaded = asRecord(raw?.stage);
    const outcome =
      (raw && typeof raw.outcome === 'string' && raw.outcome) ||
      (loaded && typeof loaded.outcome === 'string' && loaded.outcome) ||
      null;
    const quota = this.quota > 0 ? this.quota : this.stage.quota;
    if (outcome === 'won' || (quota > 0 && this.cheeseBanked >= quota && this.timeSeconds > 0.2)) {
      this.finish('won');
      return;
    }
    if (outcome === 'lost' || this.lives <= 0) this.finish('lost');
  }

  private finish(outcome: 'won' | 'lost'): void {
    if (this.ended) return;
    this.ended = true;
    const result: StageResult = {
      outcome,
      stageId: this.stage.id,
      score: this.cheeseBanked * 250 + Math.max(0, 120 - Math.floor(this.timeSeconds)) * 4,
      timeSeconds: this.timeSeconds,
      cheeseBanked: this.cheeseBanked,
      quota: this.quota > 0 ? this.quota : this.stage.quota,
      catches: this.catches,
      stars: outcome === 'won' ? (this.catches === 0 ? 3 : this.catches === 1 ? 2 : 1) : 0,
      noCatch: this.catches === 0 && outcome === 'won',
    };
    this.app.goResults(result);
  }
}

export function worldOf(stage: StageDef, x: number, y: number): { x: number; y: number } {
  if (x <= stage.width + 1 && y <= stage.height + 1) {
    return { x: (x + 0.5) * stage.tileSize, y: (y + 0.5) * stage.tileSize };
  }
  return { x, y };
}

export function cameraFor(
  stage: StageDef,
  width: number,
  height: number,
  lookX: number,
  lookY: number,
  shake: number,
): Camera {
  const worldW = stage.width * stage.tileSize;
  const worldH = stage.height * stage.tileSize;
  const zoom = Math.min(width / worldW, height / worldH);
  const follow = worldW * zoom > width + 4 || worldH * zoom > height + 4;
  return {
    x: follow ? lookX : worldW / 2,
    y: follow ? lookY : worldH / 2,
    zoom,
    shake,
    viewportWidth: width,
    viewportHeight: height,
  };
}

function drawTiles(renderer: RendererLike, stage: StageDef): void {
  const ts = stage.tileSize;
  for (let ty = 0; ty < stage.height; ty += 1) {
    const row = stage.tiles[ty] ?? '';
    for (let tx = 0; tx < stage.width; tx += 1) {
      const glyph = (row[tx] ?? '.') as TileGlyph;
      const kind = TILE_LEGEND[glyph] ?? 'floor';
      renderer.rect(tx * ts, ty * ts, ts, ts, tileColor(stage, kind, tx, ty));
    }
  }
}

function drawEntities(renderer: RendererLike, stage: StageDef, pickups: Pickup[], hole: { x: number; y: number }): void {
  renderer.circle(hole.x, hole.y, 16, '#0a0604');
  renderer.circle(hole.x, hole.y, 10, '#1a100c');
  for (const cheese of pickups) {
    if (cheese.taken) continue;
    renderer.circle(cheese.x, cheese.y, 7, '#f0c14a');
  }
  for (const entity of stage.entities) {
    if (entity.type === 'powerUp') {
      const p = worldOf(stage, entity.x, entity.y);
      renderer.rect(p.x - 6, p.y - 6, 12, 12, '#7ec8a3');
    }
  }
}

function catColor(state: CatState): string {
  if (state === 'chase' || state === 'pounce') return '#e24b4b';
  if (state === 'nap' || state === 'groom') return '#c4a15a';
  return '#e08a3c';
}

function kindAt(stage: StageDef, tx: number, ty: number): TileKind {
  if (tx < 0 || ty < 0 || tx >= stage.width || ty >= stage.height) return 'void';
  const glyph = (stage.tiles[ty]?.[tx] ?? '.') as TileGlyph;
  return TILE_LEGEND[glyph] ?? 'floor';
}

function blocked(stage: StageDef, tx: number, ty: number, allowMouseOnly: boolean): boolean {
  const kind = kindAt(stage, tx, ty);
  if (SOLID.has(kind)) return true;
  if (MOUSE_ONLY.has(kind) && !allowMouseOnly) return true;
  return false;
}

function hitsTiles(stage: StageDef, x: number, y: number, radius: number, allowMouseOnly: boolean): boolean {
  const ts = stage.tileSize;
  const x0 = Math.floor((x - radius) / ts);
  const y0 = Math.floor((y - radius) / ts);
  const x1 = Math.floor((x + radius) / ts);
  const y1 = Math.floor((y + radius) / ts);
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      if (!blocked(stage, tx, ty, allowMouseOnly)) continue;
      const rx = tx * ts;
      const ry = ty * ts;
      const nx = Math.max(rx, Math.min(x, rx + ts));
      const ny = Math.max(ry, Math.min(y, ry + ts));
      if ((nx - x) * (nx - x) + (ny - y) * (ny - y) <= radius * radius) return true;
    }
  }
  return false;
}

function moveAgainstTiles(
  stage: StageDef,
  x: number,
  y: number,
  radius: number,
  dx: number,
  dy: number,
  allowMouseOnly: boolean,
): { x: number; y: number } {
  const nx = x + dx;
  if (!hitsTiles(stage, nx, y, radius, allowMouseOnly)) x = nx;
  const ny = y + dy;
  if (!hitsTiles(stage, x, ny, radius, allowMouseOnly)) y = ny;
  return { x, y };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function firstRecord(raw: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = raw[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  const state = raw.state;
  if (state && typeof state === 'object') return firstRecord(state as Record<string, unknown>, keys);
  return null;
}

function simPoint(stage: StageDef, x: number, y: number): { x: number; y: number } {
  if (Number.isFinite(x) && Number.isFinite(y) && x <= stage.width + 2 && y <= stage.height + 2) {
    return { x: x * stage.tileSize, y: y * stage.tileSize };
  }
  return { x, y };
}

function simLength(stage: StageDef, x: number, length: number): number {
  if (Number.isFinite(x) && x <= stage.width + 2) return Math.max(6, length * stage.tileSize);
  return length;
}

function staminaMaxOf(raw: Record<string, unknown> | undefined): number | null {
  if (!raw) return null;
  const bag = asRecord(raw.stage) ?? raw;
  const mouse = firstRecord(bag, ['mouse', 'mouseRuntime']) ?? firstRecord(raw, ['mouse', 'mouseRuntime']);
  const stats = mouse?.stats as { staminaMax?: number } | undefined;
  return typeof stats?.staminaMax === 'number' ? stats.staminaMax : null;
}

function firstArrayItem(raw: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value) && value[0] && typeof value[0] === 'object') return value[0] as Record<string, unknown>;
  }
  return null;
}
