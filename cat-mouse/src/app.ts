import { createEventBus } from './engine/events';
import { FixedLoop } from './engine/loop';
import { makeRng } from './engine/rng';
import type {
  AudioBusName,
  AudioCue,
  AudioLike,
  Camera,
  Clock,
  EventBusLike,
  InputAction,
  InputSnapshot,
  KeyBindings,
  LightDraw,
  RendererLike,
  Rng,
  Scene,
  SceneContext,
  SettingsState,
  SpriteDraw,
} from './engine/types';
import type { GameMode, SimulationOptions, StageResult } from './game/types';
import type { ChapterDef, StageDef } from './content/schema';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';
import { BootScene } from './scenes/boot';
import { TitleScene } from './scenes/title';
import { ModeSelectScene } from './scenes/modeSelect';
import { ChapterMapScene } from './scenes/chapterMap';
import { PlayScene } from './scenes/play';
import { PauseScene } from './scenes/pause';
import { ResultsScene } from './scenes/results';
import { SettingsScene } from './scenes/settings';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options?: { eager?: boolean },
    ): Record<string, () => Promise<Record<string, unknown>>>;
  }
}

const ENGINE_MODULES = import.meta.glob('./engine/*.ts');
const GAME_MODULES = import.meta.glob('./game/**/*.ts');
const CONTENT_MODULES = import.meta.glob('./content/**/*.ts');

const SETTINGS_KEY = 'chase-protocol-settings';

const DEFAULT_BINDINGS: KeyBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sneak: ['ShiftLeft', 'ShiftRight'],
  dash: ['Space'],
  interact: ['KeyE'],
  decoy: ['KeyQ'],
  usePowerUp: ['KeyF'],
  pause: ['Escape'],
  mute: ['KeyM'],
  confirm: ['Enter', 'Space'],
  cancel: ['Escape'],
  debug: ['Backquote'],
};

const DEFAULT_SETTINGS: SettingsState = {
  masterVolume: 0.8,
  sfxVolume: 0.85,
  musicVolume: 0.45,
  showDebug: false,
  screenShake: true,
  highContrast: false,
  bindings: {},
};

export interface InputService {
  beginFrame(): void;
  endFrame(): void;
  snapshot(): InputSnapshot;
  setBindings?(bindings: Partial<KeyBindings>): void;
}

export interface SimulationHandle {
  step: (dt: number, input?: InputSnapshot) => void;
  raw: Record<string, unknown>;
}

export interface AppServices {
  canvas: HTMLCanvasElement;
  renderer: RendererLike;
  input: InputService;
  audio: AudioLike;
  events: EventBusLike;
  rng: Rng;
}

/** Scene stack, service construction, and the title → story → chapter 1 → stage 1 path. */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: RendererLike;
  readonly input: InputService;
  readonly audio: AudioLike;
  readonly events: EventBusLike;
  readonly rng: Rng;
  readonly overlay: Overlay;
  readonly hud: Hud;
  readonly loop: FixedLoop;
  settings: SettingsState;
  mode: GameMode = 'story';
  chapter = 1;
  stageIndex = 1;
  lastResult: StageResult | null = null;
  private readonly stack: Scene[] = [];
  private clock: Clock;
  private navigating = false;

  private constructor(services: AppServices, overlay: Overlay) {
    this.canvas = services.canvas;
    this.renderer = services.renderer;
    this.input = services.input;
    this.audio = services.audio;
    this.events = services.events;
    this.rng = services.rng;
    this.overlay = overlay;
    this.hud = new Hud(overlay.hudRoot);
    this.settings = loadSettings();
    applySettings(this);
    this.clock = {
      elapsed: 0,
      step: 1 / 60,
      tick: 0,
      alpha: 0,
      frameDelta: 0,
      scale: 1,
    };
    this.loop = new FixedLoop(
      {
        fixedUpdate: (step, clock) => this.fixedUpdate(step, clock),
        render: (alpha, clock) => this.draw(alpha, clock),
      },
      { step: 1 / 60 },
    );
  }

  static async create(canvas: HTMLCanvasElement): Promise<App> {
    const overlayEl = document.getElementById('overlay') ?? createOverlay(canvas);
    const overlay = new Overlay(overlayEl);
    const [renderer, input, audio] = await Promise.all([
      createRenderer(canvas),
      createInput(canvas),
      createAudio(),
    ]);
    return new App(
      {
        canvas,
        renderer,
        input,
        audio,
        events: createEventBus(),
        rng: makeRng(0xc4a1ce),
      },
      overlay,
    );
  }

  context(): SceneContext {
    return {
      clock: this.clock,
      input: this.input.snapshot(),
      renderer: this.renderer,
      audio: this.audio,
      events: this.events,
      rng: this.rng,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  start(): void {
    this.overlay.clear();
    this.replace(new BootScene(this));
    this.loop.start();
  }

  /** Default campaign path after title: story mode, chapter 1, stage 1. */
  prepareStoryPath(): void {
    this.mode = 'story';
    this.chapter = 1;
    this.stageIndex = 1;
  }

  goTitle(): void {
    this.overlay.clear();
    this.overlay.hideHud();
    this.replace(new TitleScene(this));
  }

  goModeSelect(): void {
    this.prepareStoryPath();
    this.replace(new ModeSelectScene(this));
  }

  goChapterMap(): void {
    this.replace(new ChapterMapScene(this));
  }

  listChapters(): Promise<ChapterDef[]> {
    return loadChapters();
  }

  async goPlay(chapter = this.chapter, index = this.stageIndex): Promise<void> {
    if (this.navigating) return;
    this.navigating = true;
    this.chapter = chapter;
    this.stageIndex = index;
    try {
      const stage = await resolveStage(chapter, index, this.mode);
      const simulation = await resolveSimulation(stage, {
        rng: this.rng,
        mode: this.mode,
        difficulty: stage.difficulty,
        seed: stage.seed,
        events: this.events,
      } as SimulationOptions);
      this.overlay.clearMenu();
      this.overlay.showHud();
      this.replace(new PlayScene(this, stage, simulation));
    } finally {
      this.navigating = false;
    }
  }

  goPause(): void {
    if (this.top()?.name === 'pause' || this.top()?.name === 'settings') return;
    const ctx = this.context();
    this.top()?.pause?.(ctx);
    this.push(new PauseScene(this));
  }

  resumePlay(): void {
    while (this.top() && this.top()?.name !== 'play') this.pop();
    this.top()?.resume?.(this.context());
  }

  goSettings(): void {
    this.push(new SettingsScene(this));
  }

  goResults(result: StageResult): void {
    this.lastResult = result;
    this.overlay.hideHud();
    this.replace(new ResultsScene(this, result));
  }

  restartStage(): void {
    void this.goPlay(this.chapter, this.stageIndex);
  }

  nextStage(): void {
    const next = this.stageIndex + 1;
    if (next > 8) {
      this.chapter += 1;
      this.stageIndex = 1;
      this.goChapterMap();
      return;
    }
    void this.goPlay(this.chapter, next);
  }

  pop(): void {
    const ctx = this.context();
    const scene = this.stack.pop();
    scene?.exit?.(ctx);
    if (this.stack.length === 0) this.goTitle();
    else this.top()?.resume?.(ctx);
  }

  push(scene: Scene): void {
    const ctx = this.context();
    this.top()?.pause?.(ctx);
    this.stack.push(scene);
    scene.enter?.(ctx);
  }

  replace(scene: Scene): void {
    const ctx = this.context();
    const previous = this.stack.pop();
    previous?.exit?.(ctx);
    this.stack.length = 0;
    this.stack.push(scene);
    scene.enter?.(ctx);
  }

  applySettings(): void {
    applySettings(this);
    saveSettings(this.settings);
  }

  toggleMute(): void {
    this.audio.muted = !this.audio.muted;
  }

  private fixedUpdate(step: number, clock: Clock): void {
    this.clock = clock;
    this.input.beginFrame();
    const ctx = this.context();
    if (ctx.input.pressed('mute')) this.toggleMute();
    this.top()?.update(ctx, step);
    this.input.endFrame();
  }

  private draw(alpha: number, clock: Clock): void {
    this.clock = clock;
    const ctx = this.context();
    for (const scene of this.stack) scene.render(ctx, alpha);
  }
}

function createOverlay(canvas: HTMLCanvasElement): HTMLElement {
  const host = canvas.parentElement ?? document.body;
  const el = document.createElement('div');
  el.id = 'overlay';
  host.append(el);
  return el;
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, bindings: {} };
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return { ...DEFAULT_SETTINGS, ...parsed, bindings: parsed.bindings ?? {} };
  } catch {
    return { ...DEFAULT_SETTINGS, bindings: {} };
  }
}

function saveSettings(settings: SettingsState): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota / private mode */
  }
}

function applySettings(app: App): void {
  app.audio.setBusGain('master', app.settings.masterVolume);
  app.audio.setBusGain('sfx', app.settings.sfxVolume);
  app.audio.setBusGain('music', app.settings.musicVolume);
  app.audio.setBusGain('ui', app.settings.sfxVolume);
  document.body.classList.toggle('high-contrast', app.settings.highContrast);
  app.input.setBindings?.(app.settings.bindings);
}

function pickLoader(
  mods: Record<string, () => Promise<Record<string, unknown>>>,
  names: string[],
): (() => Promise<Record<string, unknown>>) | null {
  for (const [key, loader] of Object.entries(mods)) {
    const file = key.split('/').pop()?.replace(/\.ts$/, '') ?? '';
    if (names.includes(file)) return loader;
  }
  return null;
}

function construct(mod: Record<string, unknown>, names: string[], args: unknown[]): unknown {
  for (const name of names) {
    const value = mod[name];
    if (typeof value !== 'function') continue;
    try {
      const out = (value as (...a: unknown[]) => unknown)(...args);
      if (out && typeof out === 'object') return out;
    } catch {
      /* try as constructor */
    }
    try {
      return new (value as new (...a: unknown[]) => object)(...args);
    } catch {
      /* next candidate */
    }
  }
  return null;
}

async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererLike> {
  const load = pickLoader(ENGINE_MODULES, ['renderer', 'render', 'canvas']);
  if (load) {
    try {
      const mod = await load();
      if (typeof mod.CanvasRenderer === 'function') {
        const inst = new (mod.CanvasRenderer as new (c: HTMLCanvasElement) => RendererLike)(canvas);
        if (isRenderer(inst)) return inst;
      }
      const inst = construct(mod, ['createRenderer', 'createCanvasRenderer', 'Renderer', 'default'], [canvas]);
      if (isRenderer(inst)) return inst;
    } catch {
      /* fallback */
    }
  }
  return new FallbackRenderer(canvas);
}

const MENU_BINDINGS: Partial<KeyBindings> = {
  confirm: ['Enter', 'Space'],
  cancel: ['Escape', 'Backspace'],
};

async function createInput(canvas: HTMLCanvasElement): Promise<InputService> {
  const load = pickLoader(ENGINE_MODULES, ['input', 'keyboard']);
  if (load) {
    try {
      const mod = await load();
      let manager: Record<string, unknown> | null = null;
      if (typeof mod.makeInput === 'function') {
        manager = (mod.makeInput as (b?: Partial<KeyBindings>) => Record<string, unknown>)(MENU_BINDINGS);
      } else if (typeof mod.InputManager === 'function') {
        manager = new (mod.InputManager as new (b?: Partial<KeyBindings>) => Record<string, unknown>)(MENU_BINDINGS);
      }
      if (manager) {
        if (typeof manager.attach === 'function') {
          (manager.attach as (target?: EventTarget) => void)(typeof window !== 'undefined' ? window : canvas);
        }
        return wrapEngineInput(manager);
      }
    } catch {
      /* fallback */
    }
  }
  return new FallbackInput(typeof window !== 'undefined' ? window : canvas, {
    ...DEFAULT_BINDINGS,
    ...MENU_BINDINGS,
  });
}

async function createAudio(): Promise<AudioLike> {
  const load = pickLoader(ENGINE_MODULES, ['audio', 'sound']);
  if (load) {
    try {
      const mod = await load();
      if (typeof mod.makeAudio === 'function') {
        const inst = (mod.makeAudio as () => unknown)();
        if (isAudio(inst)) return inst;
      }
      if (typeof mod.AudioEngine === 'function') {
        const inst = new (mod.AudioEngine as new () => AudioLike)();
        if (isAudio(inst)) return inst;
      }
      const inst = construct(mod, ['createAudio', 'WebAudio', 'Audio', 'default'], []);
      if (isAudio(inst)) return inst;
    } catch {
      /* fallback */
    }
  }
  return new FallbackAudio();
}

function isRenderer(value: unknown): value is RendererLike {
  if (!value || typeof value !== 'object') return false;
  const r = value as RendererLike;
  return typeof r.begin === 'function' && typeof r.clear === 'function' && typeof r.circle === 'function';
}

function isAudio(value: unknown): value is AudioLike {
  if (!value || typeof value !== 'object') return false;
  const a = value as AudioLike;
  return typeof a.play === 'function' && typeof a.setBusGain === 'function';
}

function wrapEngineInput(raw: Record<string, unknown>): InputService {
  return {
    beginFrame(): void {
      /* Engine InputManager.beginFrame latches prev=held; call it after the tick. */
    },
    endFrame(): void {
      if (typeof raw.beginFrame === 'function') (raw.beginFrame as () => void).call(raw);
      else if (typeof raw.endFrame === 'function') (raw.endFrame as () => void).call(raw);
    },
    snapshot(): InputSnapshot {
      if (typeof raw.snapshot === 'function') {
        const snap = (raw.snapshot as () => InputSnapshot).call(raw);
        if (snap && typeof snap.down === 'function') return snap;
      }
      if (typeof raw.down === 'function' && 'axisX' in raw) return raw as unknown as InputSnapshot;
      return {
        axisX: 0,
        axisY: 0,
        down: () => false,
        pressed: () => false,
        released: () => false,
      };
    },
    setBindings(bindings?: Partial<KeyBindings>): void {
      if (!bindings || typeof raw.rebind !== 'function') return;
      const rebind = raw.rebind as (action: string, codes: readonly string[]) => void;
      for (const [action, codes] of Object.entries(bindings)) {
        if (codes && codes.length > 0) rebind(action, codes);
      }
    },
  };
}

export async function resolveStage(chapter: number, index: number, mode: GameMode): Promise<StageDef> {
  const loaded = await loadContentModules();
  for (const mod of loaded) {
    const stage = findStageInModule(mod, chapter, index, mode);
    if (stage) return stage;
  }
  return createFallbackKitchen(chapter, index, mode);
}

export async function loadChapters(): Promise<ChapterDef[]> {
  const loaded = await loadContentModules();
  for (const mod of loaded) {
    const chapters = mod.chapters ?? mod.CHAPTERS ?? mod.chapterDefs;
    if (Array.isArray(chapters) && chapters.length > 0 && isChapter(chapters[0])) {
      return chapters as ChapterDef[];
    }
  }
  return fallbackChapters();
}

async function loadContentModules(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const [key, loader] of Object.entries(CONTENT_MODULES)) {
    if (key.endsWith('schema.ts')) continue;
    try {
      out.push(await loader());
    } catch {
      /* skip broken content while other agents write */
    }
  }
  return out;
}

function findStageInModule(
  mod: Record<string, unknown>,
  chapter: number,
  index: number,
  mode: GameMode,
): StageDef | null {
  const candidates: unknown[] = [];
  for (const value of Object.values(mod)) {
    if (isStageDef(value)) candidates.push(value);
    if (Array.isArray(value)) {
      for (const item of value) if (isStageDef(item)) candidates.push(item);
    }
    if (value && typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      if (typeof rec.get === 'function') {
        try {
          const got = rec.get(`${chapter}-${index}`) ?? rec.get(`story-0${chapter}-0${index}`);
          if (isStageDef(got)) candidates.push(got);
        } catch {
          /* ignore */
        }
      }
    }
  }
  const kind = mode === 'timeAttack' ? 'timeAttack' : mode === 'arcade' ? 'arcade' : 'story';
  for (const value of candidates) {
    const stage = value as StageDef;
    if (stage.chapter === chapter && stage.index === index && (stage.kind === kind || kind === 'story')) {
      return stage;
    }
  }
  for (const value of candidates) {
    const stage = value as StageDef;
    if (stage.chapter === chapter && stage.index === index) return stage;
  }
  return null;
}

export function isStageDef(value: unknown): value is StageDef {
  if (!value || typeof value !== 'object') return false;
  const s = value as StageDef;
  return Array.isArray(s.tiles) && typeof s.width === 'number' && typeof s.height === 'number' && !!s.spawn;
}

function isChapter(value: unknown): value is ChapterDef {
  if (!value || typeof value !== 'object') return false;
  const c = value as ChapterDef;
  return typeof c.index === 'number' && typeof c.title === 'string' && Array.isArray(c.stageIds);
}

export async function resolveSimulation(
  stage: StageDef,
  options: SimulationOptions,
): Promise<SimulationHandle | null> {
  const gameEntries = Object.entries(GAME_MODULES).sort(([a], [b]) => {
    const score = (key: string) => (key.includes('simulation') ? 0 : key.includes('sim') ? 1 : 2);
    return score(a) - score(b);
  });
  for (const [key, loader] of gameEntries) {
    const file = key.split('/').pop() ?? '';
    if (file === 'types.ts' || file === 'defaults.ts') continue;
    try {
      const mod = await loader();
      const handle = simulationFromModule(mod, stage, options);
      if (handle) return handle;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function simulationFromModule(
  mod: Record<string, unknown>,
  stage: StageDef,
  options: SimulationOptions,
): SimulationHandle | null {
  const names = ['createSimulation', 'createSim', 'createStage', 'Simulation', 'StageSimulation', 'GameWorld', 'default'];
  const inst = construct(mod, names, [stage, options]);
  if (!inst || typeof inst !== 'object') return null;
  const raw = inst as Record<string, unknown>;
  const step = raw.step ?? raw.update ?? raw.tick;
  if (typeof step !== 'function') return null;
  return {
    raw,
    step(dt: number, input?: InputSnapshot) {
      if (typeof raw.setInput === 'function') (raw.setInput as (s: InputSnapshot) => void)(input as InputSnapshot);
      if (typeof raw.applyInput === 'function') (raw.applyInput as (s: InputSnapshot) => void)(input as InputSnapshot);
      (step as (dt: number, input?: InputSnapshot) => void).call(raw, dt, input);
    },
  };
}

export function fallbackChapters(): ChapterDef[] {
  const titles = [
    ['The Kitchen', 'kitchen', 'Gran left the light on. The plate is still warm.'],
    ['Cellar Stairs', 'cellar', 'Dust, jars, and something that breathes in the dark.'],
    ['Alley Cans', 'alley', 'Rain on tin. Pounce knows every lid.'],
    ['Sewer Gate', 'sewer', 'The pipes remember every footfall.'],
    ['Attic Beams', 'attic', 'Trunks, moths, and a moon-shaped window.'],
    ['Carnival Lot', 'carnival', 'Closed booths. Open appetites.'],
    ['Museum Wing', 'museum', 'Do not touch the cheese. Especially the cheese.'],
    ['Subway Mouth', 'subway', 'A draft, a rumble, a yellow eye in the tunnel.'],
    ['Dock Night', 'docks', 'Ropes, crates, and a tide that steals crumbs.'],
    ['Greenhouse', 'greenhouse', 'Wet leaves hide more than scent.'],
    ['Clocktower', 'clocktower', 'Every tick is a footstep.'],
    ['Moon Lab', 'moonLab', 'They built a better mousetrap. Then they left.'],
  ] as const;
  return titles.map((entry, i) => ({
    index: i + 1,
    title: entry[0],
    theme: entry[1],
    blurb: entry[2],
    stageIds: Array.from({ length: 8 }, (_, s) => `story-${pad(i + 1)}-${pad(s + 1)}`),
    unlockAfter: i,
  }));
}

export function createFallbackKitchen(chapter = 1, index = 1, mode: GameMode = 'story'): StageDef {
  const width = 32;
  const height = 18;
  const tileSize = 40;
  const grid: string[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: string[] = [];
    for (let x = 0; x < width; x += 1) {
      let glyph = '.';
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) glyph = '#';
      row.push(glyph);
    }
    grid.push(row);
  }

  for (let x = 1; x < width - 1; x += 1) grid[1][x] = 'T';
  for (let y = 1; y <= 4; y += 1) {
    grid[y][1] = '#';
    grid[y][2] = '#';
  }
  for (let x = 22; x <= 27; x += 1) grid[1][x] = '~';
  for (let y = 7; y <= 9; y += 1) {
    for (let x = 12; x <= 19; x += 1) grid[y][x] = 'T';
  }
  grid[4][6] = 'X';
  grid[4][7] = 'X';
  grid[5][6] = 'X';
  grid[10][4] = 'X';
  grid[11][4] = 'X';
  for (let y = 12; y <= 15; y += 1) {
    for (let x = 8; x <= 14; x += 1) {
      if (grid[y][x] === '.') grid[y][x] = 'r';
    }
  }
  grid[height - 2][2] = 'o';
  grid[height - 2][width - 3] = 'v';
  grid[8][26] = 'g';
  grid[9][26] = 'g';
  grid[3][16] = 'D';

  const tiles = grid.map((row) => row.join(''));
  const decor = tiles.map((row) => ' '.repeat(row.length));
  const kind = mode === 'timeAttack' ? 'timeAttack' : mode === 'arcade' ? 'arcade' : 'story';

  return {
    id: `story-${pad(chapter)}-${pad(index)}`,
    chapter,
    index,
    name: index === 1 ? 'Midnight Crumbs' : `Kitchen ${index}`,
    theme: 'kitchen',
    kind,
    seed: 1000 + chapter * 20 + index,
    width,
    height,
    tileSize,
    tiles,
    decor,
    spawn: { x: 3, y: 15 },
    entities: [
      { type: 'hole', x: 2, y: 16, id: 'exit' },
      { type: 'cheese', x: 15, y: 6, value: 1 },
      { type: 'cheese', x: 24, y: 3, value: 1 },
      { type: 'cheese', x: 10, y: 13, value: 1 },
      { type: 'cat', x: 27, y: 4, breed: 'tabby', patrol: 1 },
      { type: 'powerUp', x: 29, y: 16, kind: 'speed' },
    ],
    lights: [
      { x: 16, y: 4, radius: 180, intensity: 0.55, color: '#ffc070' },
      { x: 6, y: 14, radius: 120, intensity: 0.28, color: '#d8a050' },
    ],
    patrols: [
      {
        id: 1,
        loop: true,
        pauseSeconds: 0.6,
        points: [
          { x: 27, y: 4 },
          { x: 22, y: 12 },
          { x: 18, y: 5 },
        ],
      },
    ],
    dialogue: [
      { at: 'enter', speaker: 'Narrator', line: 'The kitchen is asleep. The cheese is not.' },
    ],
    hints: {
      ambushSpots: [{ x: 16, y: 10 }],
      searchSpots: [
        { x: 10, y: 13 },
        { x: 24, y: 3 },
      ],
      aggression: 0.7,
      scentBias: 0.8,
      hearingBias: 0.6,
      campHoleChance: 0.15,
      leashRadius: 18,
    },
    objectives: [{ kind: 'quota', value: 3, optional: false, label: 'Bank 3 cheese' }],
    quota: 3,
    parTime: 90,
    lives: 3,
    ambient: 0.35,
    difficulty: 1,
    music: 'kitchen-night',
    tags: ['kitchen', 'intro', 'fallback'],
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

class FallbackRenderer implements RendererLike {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private camera: Camera | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  begin(camera: Camera): void {
    this.camera = camera;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const shakeX = camera.shake > 0 ? (Math.random() - 0.5) * camera.shake * 8 : 0;
    const shakeY = camera.shake > 0 ? (Math.random() - 0.5) * camera.shake * 8 : 0;
    ctx.translate(this.canvas.width / 2 + shakeX, this.canvas.height / 2 + shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
  }

  clear(color: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  sprite(draw: SpriteDraw): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = draw.alpha ?? 1;
    ctx.fillStyle = draw.color;
    ctx.fillRect(draw.x, draw.y, draw.w, draw.h);
    ctx.restore();
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  circle(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  text(text: string, x: number, y: number, color: string, size = 16, align: CanvasTextAlign = 'left'): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.font = `${size}px "Iowan Old Style", Palatino, Georgia, serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  light(light: LightDraw): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, light.radius);
    gradient.addColorStop(0, hexAlpha(light.color, light.intensity * 0.45));
    gradient.addColorStop(1, hexAlpha(light.color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    if (light.cone !== undefined) {
      const angle = light.angle ?? 0;
      ctx.moveTo(light.x, light.y);
      ctx.arc(light.x, light.y, light.radius, angle - light.cone, angle + light.cone);
    } else {
      ctx.arc(light.x, light.y, light.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

  end(): void {
    this.ctx.restore();
    this.camera = null;
  }
}

function hexAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

class FallbackInput implements InputService {
  private readonly down = new Set<string>();
  private readonly held = new Set<InputAction>();
  private readonly just = new Set<InputAction>();
  private readonly letGo = new Set<InputAction>();
  private bindings: KeyBindings;
  private readonly onDown: (event: KeyboardEvent) => void;
  private readonly onUp: (event: KeyboardEvent) => void;

  constructor(target: EventTarget, bindings: KeyBindings) {
    this.bindings = bindings;
    this.onDown = (event: KeyboardEvent) => {
      this.down.add(event.code);
      if (shouldPrevent(event.code)) event.preventDefault();
    };
    this.onUp = (event: KeyboardEvent) => {
      this.down.delete(event.code);
    };
    target.addEventListener('keydown', this.onDown as EventListener);
    target.addEventListener('keyup', this.onUp as EventListener);
    window.addEventListener('blur', () => this.down.clear());
  }

  setBindings(bindings: Partial<KeyBindings>): void {
    this.bindings = { ...this.bindings, ...bindings };
  }

  beginFrame(): void {
    this.just.clear();
    this.letGo.clear();
    const next = new Set<InputAction>();
    for (const action of Object.keys(this.bindings) as InputAction[]) {
      const codes = this.bindings[action] ?? [];
      const isDown = codes.some((code) => this.down.has(code));
      if (isDown) next.add(action);
      if (isDown && !this.held.has(action)) this.just.add(action);
      if (!isDown && this.held.has(action)) this.letGo.add(action);
    }
    this.held.clear();
    for (const action of next) this.held.add(action);
  }

  endFrame(): void {
    this.just.clear();
    this.letGo.clear();
  }

  snapshot(): InputSnapshot {
    let axisX = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    let axisY = (this.held.has('down') ? 1 : 0) - (this.held.has('up') ? 1 : 0);
    const len = Math.hypot(axisX, axisY);
    if (len > 1) {
      axisX /= len;
      axisY /= len;
    }
    return {
      axisX,
      axisY,
      down: (action) => this.held.has(action),
      pressed: (action) => this.just.has(action),
      released: (action) => this.letGo.has(action),
    };
  }
}

function shouldPrevent(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space' || code === 'Enter';
}

class FallbackAudio implements AudioLike {
  muted = false;
  private ctx: AudioContext | null = null;
  private readonly gains = new Map<AudioBusName, number>([
    ['master', 0.8],
    ['sfx', 0.85],
    ['music', 0.45],
    ['ui', 0.7],
    ['ambience', 0.4],
  ]);
  private listenerX = 0;
  private listenerY = 0;

  play(cue: AudioCue, atX?: number, atY?: number): void {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cue.type;
    osc.frequency.value = cue.frequency;
    if (cue.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, cue.sweep), ctx.currentTime + cue.duration);
    let distance = 1;
    if (atX !== undefined && atY !== undefined) {
      distance = Math.max(0.2, 1 - Math.hypot(atX - this.listenerX, atY - this.listenerY) / 640);
    }
    const bus = this.gains.get(cue.bus) ?? 1;
    const master = this.gains.get('master') ?? 1;
    gain.gain.value = cue.gain * bus * master * distance;
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cue.duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + cue.duration + 0.02);
  }

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  setBusGain(bus: AudioBusName, gain: number): void {
    this.gains.set(bus, Math.max(0, Math.min(1, gain)));
  }

  busGain(bus: AudioBusName): number {
    return this.gains.get(bus) ?? 1;
  }

  duck(bus: AudioBusName, amount: number, seconds: number): void {
    const current = this.busGain(bus);
    this.setBusGain(bus, current * (1 - amount));
    window.setTimeout(() => this.setBusGain(bus, current), seconds * 1000);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }
}
