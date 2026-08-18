import { makeRng, seedFrom } from '../../engine/rng';
import type { Rng } from '../../engine/types';
import type { HazardKind, PowerUpKind } from '../../game/types';
import {
  GRAN_ENTER,
  IDLE_LINES,
  LOSE_LINES,
  NARRATOR_ENTER,
  POUNCE_ENTER,
  RADIO_ENTER,
  SQUEAK_ENTER,
  THEME_VERBS,
  WIN_LINES,
  beat,
  pickLine,
} from '../banks';
import type {
  AiHints,
  DialogueBeat,
  EntitySpawn,
  LightDef,
  PatrolRoute,
  StageDef,
  StageObjective,
  ThemeId,
} from '../schema';
import { THEME_KITS } from '../themeKits';
import { THEME_MUSIC } from '../palettes';
import {
  at,
  carveL,
  decorRows,
  farthestWalkable,
  floodFrom,
  listWalkable,
  paint,
  randomWalkable,
  rowsOf,
  type Grid,
} from './grid';
import { buildMazeLayout } from './maze';
import {
  buildChannels,
  buildDualHalls,
  buildGalleries,
  buildOpenIslands,
  buildRing,
  buildRoomLayout,
  type RoomLayout,
} from './rooms';

export type Topology =
  | 'rooms'
  | 'maze'
  | 'islands'
  | 'galleries'
  | 'channels'
  | 'ring'
  | 'dual';

export const TOPOLOGIES: readonly Topology[] = [
  'rooms',
  'maze',
  'islands',
  'galleries',
  'channels',
  'ring',
  'dual',
];

export interface StageFactoryOptions {
  readonly id: string;
  readonly name: string;
  readonly chapter: number;
  readonly index: number;
  readonly theme: ThemeId;
  readonly kind: StageDef['kind'];
  readonly seed?: number;
  readonly width?: number;
  readonly height?: number;
  readonly quota?: number;
  readonly lives?: number;
  readonly topology?: Topology;
  readonly catCount?: number;
  readonly tags?: readonly string[];
}

function topologyFor(seed: number, chapter: number, index: number): Topology {
  if (chapter === 1 && index === 1) return 'islands';
  const keyed = (seed + chapter * 17 + index * 31) >>> 0;
  return TOPOLOGIES[keyed % TOPOLOGIES.length] as Topology;
}

function layoutFor(rng: Rng, width: number, height: number, theme: ThemeId, topology: Topology): RoomLayout {
  switch (topology) {
    case 'maze':
      return buildMazeLayout(rng, width, height, theme);
    case 'islands':
      return buildOpenIslands(rng, width, height, theme);
    case 'galleries':
      return buildGalleries(rng, width, height, theme);
    case 'channels':
      return buildChannels(rng, width, height, theme);
    case 'ring':
      return buildRing(rng, width, height, theme);
    case 'dual':
      return buildDualHalls(rng, width, height, theme);
    default:
      return buildRoomLayout(rng, width, height, theme, 3 + (width > 20 ? 1 : 0));
  }
}

function ensurePath(grid: Grid, ax: number, ay: number, bx: number, by: number, rng: Rng): void {
  const reachable = floodFrom(grid, ax, ay);
  if (reachable.has(by * grid.width + bx)) return;
  carveL(grid, ax, ay, bx, by, rng.bool());
}

function takeSpot(
  spots: { x: number; y: number }[],
  avoid: { x: number; y: number }[],
  minDist: number,
): { x: number; y: number } | null {
  for (let i = 0; i < spots.length; i += 1) {
    const spot = spots[i];
    if (!spot) continue;
    if (avoid.some((a) => Math.abs(a.x - spot.x) + Math.abs(a.y - spot.y) < minDist)) continue;
    spots.splice(i, 1);
    return spot;
  }
  return spots.shift() ?? null;
}

function patrolAround(grid: Grid, origin: { x: number; y: number }, rng: Rng): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [origin];
  const walkable = listWalkable(grid);
  if (walkable.length === 0) return points;
  const count = 3 + rng.int(0, 3);
  let current = origin;
  for (let i = 0; i < count; i += 1) {
    let best = current;
    let bestD = -1;
    for (const spot of walkable) {
      const d = Math.abs(spot.x - current.x) + Math.abs(spot.y - current.y);
      if (d > bestD && d < 10 && d > 2) {
        bestD = d;
        best = spot;
      }
    }
    if (bestD < 0) best = rng.pick(walkable);
    points.push(best);
    current = best;
  }
  return points;
}

function uniqueTitle(id: string): string {
  const slug = id.split('-').slice(2).join(' ') || id;
  return slug.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function buildStage(options: StageFactoryOptions, rngInput?: Rng): StageDef {
  const seed = options.seed ?? seedFrom(options.id, options.chapter, options.index);
  const rng = rngInput ?? makeRng(seed);
  const kit = THEME_KITS[options.theme];
  const topology = options.topology ?? topologyFor(seed, options.chapter, options.index);
  const width = options.width ?? 16 + rng.int(0, 9);
  const height = options.height ?? 12 + rng.int(0, 7);
  const layout = layoutFor(rng, width, height, options.theme, topology);
  const { grid } = layout;

  const spawnBase = randomWalkable(grid, rng);
  if (!spawnBase) throw new Error(`no walkable tiles for ${options.id}`);
  const spawn = spawnBase;
  const hole = farthestWalkable(grid, spawn.x, spawn.y);
  paint(grid, hole.x, hole.y, 'o');
  ensurePath(grid, spawn.x, spawn.y, hole.x, hole.y, rng);

  const chapter = Math.max(1, options.chapter);
  const quota = options.quota ?? Math.min(12, 3 + Math.floor((chapter - 1) / 2) + (options.index > 5 ? 1 : 0));
  const catCount =
    options.catCount ?? (options.kind === 'arcade' ? 1 + Math.floor(chapter / 4) : chapter >= 10 ? 2 : chapter >= 7 ? 2 : 1);
  const cheeseCount = quota + 1 + rng.int(0, 3);
  const lives = options.lives ?? (chapter <= 2 ? 3 : chapter >= 11 ? 2 : 3);

  const reserved = [spawn, hole];
  const spots = listWalkable(grid);
  rng.shuffle(spots);

  const entities: EntitySpawn[] = [
    { type: 'hole', x: hole.x, y: hole.y, id: `${options.id}-hole` },
  ];

  for (let i = 0; i < cheeseCount; i += 1) {
    const spot = takeSpot(spots, reserved, i === 0 ? 3 : 2);
    if (!spot) break;
    reserved.push(spot);
    entities.push({
      type: 'cheese',
      x: spot.x,
      y: spot.y,
      value: 1 + (rng.bool(0.12) ? 1 : 0),
      guarded: options.kind !== 'timeAttack' && rng.bool(0.08 + chapter * 0.02),
    });
  }

  const patrols: PatrolRoute[] = [];
  for (let i = 0; i < catCount; i += 1) {
    const spot = takeSpot(spots, [spawn, hole], 4) ?? farthestWalkable(grid, spawn.x, spawn.y);
    reserved.push(spot);
    const breed = kit.breeds[(chapter + options.index + i) % kit.breeds.length] as string;
    const route = patrolAround(grid, spot, rng);
    patrols.push({
      id: i + 1,
      loop: rng.bool(0.7),
      pauseSeconds: 0.4 + rng.next() * 1.4,
      points: route,
    });
    entities.push({
      type: 'cat',
      x: spot.x,
      y: spot.y,
      breed,
      patrol: i + 1,
      facing: rng.next() * Math.PI * 2,
    });
  }

  if (options.kind !== 'timeAttack' && rng.bool(0.7)) {
    const kind = rng.pick(kit.powerUps) as PowerUpKind;
    const spot = takeSpot(spots, reserved, 2);
    if (spot) {
      reserved.push(spot);
      entities.push({ type: 'powerUp', x: spot.x, y: spot.y, kind });
    }
  }

  const hazardCount = options.kind === 'timeAttack' ? rng.int(0, 2) : rng.int(chapter > 3 ? 1 : 0, 2 + Math.floor(chapter / 4));
  for (let i = 0; i < hazardCount; i += 1) {
    const spot = takeSpot(spots, [spawn, hole], 3);
    if (!spot) break;
    reserved.push(spot);
    const kind = rng.pick(kit.hazards) as HazardKind;
    entities.push({ type: 'hazard', x: spot.x, y: spot.y, kind });
  }

  if (chapter >= 3 && rng.bool(0.4)) {
    const crumb = takeSpot(spots, reserved, 1);
    if (crumb) {
      reserved.push(crumb);
      entities.push({ type: 'crumb', x: crumb.x, y: crumb.y, value: 1 });
    }
  }

  if (chapter >= 4 && rng.bool(0.35)) {
    const keySpot = takeSpot(spots, reserved, 2);
    const doorSpot = takeSpot(spots, reserved, 2);
    if (keySpot && doorSpot) {
      const keyId = `${options.id}-key`;
      entities.push({ type: 'key', x: keySpot.x, y: keySpot.y, keyId });
      entities.push({
        type: 'door',
        x: doorSpot.x,
        y: doorSpot.y,
        id: `${options.id}-door`,
        locked: true,
        keyId,
      });
      paint(grid, doorSpot.x, doorSpot.y, 'D');
    }
  }

  if (rng.bool(0.5)) {
    const prop = takeSpot(spots, reserved, 1);
    if (prop) {
      entities.push({
        type: 'decorProp',
        x: prop.x,
        y: prop.y,
        note: rng.pick(kit.landmarks),
      });
    }
  }

  const lights: LightDef[] = [];
  const lightCount = 2 + rng.int(0, 3);
  for (let i = 0; i < lightCount; i += 1) {
    const spot = spots[i * 3] ?? spawn;
    lights.push({
      x: spot.x,
      y: spot.y,
      radius: 3.5 + rng.next() * 3.5,
      intensity: 0.45 + rng.next() * 0.5,
      color: i === 0 ? '#fff1c8' : undefined,
      flicker: rng.bool(0.3) ? 0.15 + rng.next() * 0.3 : 0,
      on: true,
    });
  }
  lights.push({
    x: hole.x,
    y: hole.y,
    radius: 2.2,
    intensity: 0.7,
    color: '#d4f0a0',
    on: true,
  });

  const verbs = THEME_VERBS[options.theme];
  const landmark = rng.pick(kit.landmarks);
  const dialogue: DialogueBeat[] = [
    beat('enter', 'Narrator', `${pickLine(NARRATOR_ENTER, seed)} The ${landmark} ${rng.pick(verbs)}s in the dark.`),
    beat('enter', 'Squeak', pickLine(SQUEAK_ENTER, seed + 3), 0.4),
    beat('enter', rng.bool() ? 'Gran' : 'Radio', pickLine(rng.bool() ? GRAN_ENTER : RADIO_ENTER, seed + 9), 0.9),
    beat('firstCheese', 'Squeak', `A wedge by the ${landmark}. Heavy in the teeth, louder in the mind.`),
    beat('firstSpotted', 'Pounce', pickLine(POUNCE_ENTER, seed + 11)),
    beat('halfQuota', 'Radio', `Half the quota. The ${rng.pick(verbs)} is not a strategy, but it is a mood.`),
    beat('lowLives', 'Gran', pickLine(GRAN_ENTER, seed + 17)),
    beat('win', 'Squeak', pickLine(WIN_LINES, seed + 19)),
    beat('lose', 'Pounce', pickLine(LOSE_LINES, seed + 21)),
    beat('idle', 'Narrator', pickLine(IDLE_LINES, seed + 23), 8),
  ];

  const cheeseSpots = entities.filter((e) => e.type === 'cheese').map((e) => ({ x: e.x, y: e.y }));
  const hints: AiHints = {
    ambushSpots: [
      { x: hole.x, y: Math.max(1, hole.y - 1) },
      cheeseSpots[0] ?? { x: hole.x, y: hole.y },
    ],
    searchSpots: cheeseSpots.slice(0, 4),
    aggression: 0.45 + chapter * 0.05 + (options.kind === 'arcade' ? 0.15 : 0),
    scentBias: 0.35 + (kit.id === 'sewer' || kit.id === 'docks' ? 0.25 : 0) + rng.next() * 0.2,
    hearingBias: 0.4 + (kit.id === 'subway' || kit.id === 'clocktower' ? 0.25 : 0) + rng.next() * 0.2,
    campHoleChance: 0.08 + (catCount > 1 ? 0.12 : 0) + (options.index === 8 ? 0.2 : 0),
    leashRadius: 6 + chapter,
  };

  const parTime = Math.round(48 + width * height * 0.12 + quota * 9 + catCount * 8);
  const objectives: StageObjective[] = [
    { kind: 'quota', value: quota, optional: false, label: `Bank ${quota} cheese` },
  ];
  if (options.kind === 'timeAttack') {
    objectives.push({ kind: 'timeLimit', value: parTime, optional: false, label: `Beat ${parTime}s` });
  } else {
    objectives.push({ kind: 'noCatch', value: 1, optional: true, label: 'Ghost clear' });
  }
  if (options.kind === 'story' && options.index >= 6) {
    objectives.push({ kind: 'reachExit', value: 1, optional: false, label: 'Return to the hole' });
  }

  const tags = [
    options.theme,
    topology,
    options.kind,
    `ch${String(chapter).padStart(2, '0')}`,
    ...(options.tags ?? []),
    catCount > 1 ? 'multi-cat' : 'solo-cat',
    quota >= 6 ? 'heavy-quota' : 'light-quota',
  ];

  return {
    id: options.id,
    chapter: options.kind === 'story' ? chapter : 0,
    index: options.index,
    name: options.name || uniqueTitle(options.id),
    theme: options.theme,
    kind: options.kind,
    seed,
    width: grid.width,
    height: grid.height,
    tileSize: 16,
    tiles: rowsOf(grid),
    decor: decorRows(grid, rng, seed),
    spawn,
    entities,
    lights,
    patrols,
    dialogue,
    hints,
    objectives,
    quota,
    parTime,
    lives,
    ambient: kit.ambient,
    difficulty: Math.min(10, 1 + (chapter - 1) * 0.7 + options.index * 0.15),
    music: THEME_MUSIC[options.theme],
    tags,
  };
}

export function buildStoryStage(id: string, chapter: number, index: number, theme: ThemeId, name?: string): StageDef {
  return buildStage({
    id,
    name: name ?? uniqueTitle(id),
    chapter,
    index,
    theme,
    kind: 'story',
  });
}
