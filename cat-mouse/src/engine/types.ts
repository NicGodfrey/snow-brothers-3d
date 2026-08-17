/**
 * Shared engine contracts. Owned by lucy; downstream slices import from here
 * rather than redeclaring geometry, ECS or service shapes.
 */

export type Entity = number;
export const NULL_ENTITY: Entity = 0;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Axis = 'x' | 'y';

export type Direction4 = 'north' | 'east' | 'south' | 'west';

export type Direction8 =
  | 'north'
  | 'northEast'
  | 'east'
  | 'southEast'
  | 'south'
  | 'southWest'
  | 'west'
  | 'northWest';

/** Deterministic random source. Every gameplay system takes one of these. */
export interface Rng {
  readonly seed: number;
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  range(min: number, max: number): number;
  bool(chance?: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): T[];
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  fork(salt: number): Rng;
  state(): number;
  restore(state: number): void;
}

export interface Clock {
  /** Seconds since the loop started, advanced in fixed steps. */
  readonly elapsed: number;
  /** Fixed step size in seconds. */
  readonly step: number;
  /** Number of fixed updates executed. */
  readonly tick: number;
  /** Interpolation alpha in [0,1] for render smoothing. */
  readonly alpha: number;
  /** Wall-clock delta of the last frame in seconds (unclamped). */
  readonly frameDelta: number;
  readonly scale: number;
}

export interface LoopCallbacks {
  fixedUpdate(step: number, clock: Clock): void;
  render(alpha: number, clock: Clock): void;
}

export interface LoopOptions {
  step?: number;
  maxFrameDelta?: number;
  maxStepsPerFrame?: number;
  now?: () => number;
  schedule?: (cb: (timeMs: number) => void) => number;
  cancel?: (handle: number) => void;
}

export type ComponentId = number;

export interface ComponentType<T> {
  readonly id: ComponentId;
  readonly name: string;
  create(init?: Partial<T>): T;
}

export interface QuerySpec {
  all?: readonly ComponentType<unknown>[];
  none?: readonly ComponentType<unknown>[];
  any?: readonly ComponentType<unknown>[];
}

export interface SystemContext {
  world: WorldLike;
  step: number;
  clock: Clock;
  rng: Rng;
  events: EventBusLike;
}

export interface System {
  readonly name: string;
  readonly order: number;
  readonly enabled?: boolean;
  update(ctx: SystemContext): void;
}

export interface WorldLike {
  create(): Entity;
  destroy(entity: Entity): void;
  alive(entity: Entity): boolean;
  add<T>(entity: Entity, type: ComponentType<T>, init?: Partial<T>): T;
  get<T>(entity: Entity, type: ComponentType<T>): T | undefined;
  has(entity: Entity, type: ComponentType<unknown>): boolean;
  remove(entity: Entity, type: ComponentType<unknown>): void;
  query(spec: QuerySpec): readonly Entity[];
  readonly entityCount: number;
}

export type EventHandler<T> = (payload: T) => void;

export interface EventBusLike {
  emit<T>(topic: string, payload: T): void;
  on<T>(topic: string, handler: EventHandler<T>): () => void;
  once<T>(topic: string, handler: EventHandler<T>): () => void;
  off(topic: string, handler: EventHandler<never>): void;
  clear(topic?: string): void;
  readonly drained: number;
}

/** Logical tile classes shared by content, physics and pathfinding. */
export type TileKind =
  | 'void'
  | 'floor'
  | 'wall'
  | 'crate'
  | 'table'
  | 'water'
  | 'grate'
  | 'vent'
  | 'hole'
  | 'door'
  | 'oneWay'
  | 'rug'
  | 'glass'
  | 'pipe'
  | 'stairs'
  | 'ledge';

export interface TileProps {
  readonly kind: TileKind;
  readonly solid: boolean;
  /** Movement cost multiplier for pathfinding; Infinity means impassable. */
  readonly cost: number;
  /** Extra noise generated when a walker crosses the tile. */
  readonly noise: number;
  /** Fraction of scent retained per second on this tile. */
  readonly scentRetention: number;
  /** Blocks line of sight. */
  readonly opaque: boolean;
  /** Only the mouse fits (cat is too large). */
  readonly mouseOnly: boolean;
}

export interface TileMapLike {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  at(tx: number, ty: number): TileKind;
  props(tx: number, ty: number): TileProps;
  solid(tx: number, ty: number): boolean;
  inBounds(tx: number, ty: number): boolean;
  index(tx: number, ty: number): number;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface PathRequest {
  start: GridPoint;
  goal: GridPoint;
  /** Agents that cannot use mouse-only tiles pass `false`. */
  allowMouseOnly?: boolean;
  maxNodes?: number;
  heuristicWeight?: number;
}

export interface PathResult {
  found: boolean;
  nodes: GridPoint[];
  cost: number;
  expanded: number;
}

export interface FlowFieldLike {
  readonly width: number;
  readonly height: number;
  cost(x: number, y: number): number;
  direction(x: number, y: number): Vec2;
}

export interface ScentSampleLike {
  strength(x: number, y: number): number;
  gradient(x: number, y: number): Vec2;
}

export type InputAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'sneak'
  | 'dash'
  | 'interact'
  | 'decoy'
  | 'usePowerUp'
  | 'pause'
  | 'mute'
  | 'confirm'
  | 'cancel'
  | 'debug';

export interface InputSnapshot {
  readonly axisX: number;
  readonly axisY: number;
  down(action: InputAction): boolean;
  pressed(action: InputAction): boolean;
  released(action: InputAction): boolean;
}

export type KeyBindings = Record<InputAction, readonly string[]>;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  shake: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SpriteDraw {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  rotation?: number;
  alpha?: number;
  layer?: number;
}

export interface LightDraw {
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
  /** Cone half angle in radians; omit for an omni light. */
  cone?: number;
  angle?: number;
}

export interface ParticleSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
  drag?: number;
  gravity?: number;
}

export interface RendererLike {
  begin(camera: Camera): void;
  clear(color: string): void;
  sprite(draw: SpriteDraw): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  circle(x: number, y: number, r: number, color: string): void;
  line(x1: number, y1: number, x2: number, y2: number, color: string, width?: number): void;
  text(text: string, x: number, y: number, color: string, size?: number, align?: CanvasTextAlign): void;
  light(light: LightDraw): void;
  end(): void;
}

export type AudioBusName = 'master' | 'sfx' | 'music' | 'ui' | 'ambience';

export interface AudioCue {
  readonly id: string;
  readonly bus: AudioBusName;
  readonly frequency: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
  readonly sweep?: number;
}

export interface AudioLike {
  play(cue: AudioCue, atX?: number, atY?: number): void;
  setListener(x: number, y: number): void;
  setBusGain(bus: AudioBusName, gain: number): void;
  busGain(bus: AudioBusName): number;
  duck(bus: AudioBusName, amount: number, seconds: number): void;
  muted: boolean;
}

export interface SceneContext {
  readonly clock: Clock;
  readonly input: InputSnapshot;
  readonly renderer: RendererLike;
  readonly audio: AudioLike;
  readonly events: EventBusLike;
  readonly rng: Rng;
  readonly width: number;
  readonly height: number;
}

export interface Scene {
  readonly name: string;
  enter?(ctx: SceneContext): void;
  exit?(ctx: SceneContext): void;
  pause?(ctx: SceneContext): void;
  resume?(ctx: SceneContext): void;
  update(ctx: SceneContext, step: number): void;
  render(ctx: SceneContext, alpha: number): void;
}

export interface SpatialHashLike<T> {
  insert(item: T, bounds: Rect): void;
  clear(): void;
  query(bounds: Rect): readonly T[];
  readonly size: number;
}

export interface SaveSlot {
  version: number;
  profile: string;
  createdAt: number;
  updatedAt: number;
  unlockedChapters: number;
  stageRecords: Record<string, StageRecord>;
  achievements: string[];
  settings: SettingsState;
  totals: {
    cheese: number;
    catches: number;
    deaths: number;
    playSeconds: number;
    dashes: number;
    stealthClears: number;
  };
}

export interface StageRecord {
  stageId: string;
  cleared: boolean;
  bestScore: number;
  bestTime: number;
  stars: number;
  attempts: number;
  noCatchClear: boolean;
}

export interface SettingsState {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  showDebug: boolean;
  screenShake: boolean;
  highContrast: boolean;
  bindings: Partial<KeyBindings>;
}

export interface ReplayFrame {
  tick: number;
  bits: number;
}

export interface ReplayLog {
  seed: number;
  stageId: string;
  frames: ReplayFrame[];
}

export interface AchievementProgress {
  id: string;
  unlocked: boolean;
  progress: number;
  target: number;
}
