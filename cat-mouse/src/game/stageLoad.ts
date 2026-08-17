import type { Entity } from '../engine/types';
import { World } from '../engine/ecs';
import { makeRng } from '../engine/rng';
import type { StageDef, EntitySpawn, AiHints } from '../content/schema';
import type {
  CatRuntime,
  CheeseRuntime,
  DecoyRuntime,
  DoorRuntime,
  HazardKind,
  HazardRuntime,
  HoleRuntime,
  LightRuntime,
  MouseRuntime,
  PowerUpKind,
  PowerUpRuntime,
  ScoreState,
  StageOutcome,
  StageResult,
  SwitchRuntime,
} from './types';
import { breedKit, HOLE_RADIUS, mouseStatsForDifficulty, scaleCatStats } from './defaults';
import { createMouse } from './mouse';
import { createCat } from './cat';
import { createCheese } from './cheese';
import { createHole } from './holes';
import { createHazard } from './hazards';
import { createPowerUp } from './powerups';
import { createScoreState } from './score';
import { createDirector } from './director';
import { ScentField } from './senses';
import { tilesFromRows, type GameTileMap } from './tiles';
import type { DirectorState } from './types';

export interface LoosePickup {
  entity: Entity;
  x: number;
  y: number;
  taken: boolean;
  keyId: string;
}

export interface CrumbPickup {
  entity: Entity;
  x: number;
  y: number;
  taken: boolean;
}

export interface LoadedStage {
  def: StageDef;
  world: World;
  tiles: GameTileMap;
  mouse: MouseRuntime;
  cats: CatRuntime[];
  cheeses: CheeseRuntime[];
  holes: HoleRuntime[];
  hazards: HazardRuntime[];
  powerUps: PowerUpRuntime[];
  decoys: DecoyRuntime[];
  lights: LightRuntime[];
  switches: SwitchRuntime[];
  doors: DoorRuntime[];
  crumbs: CrumbPickup[];
  keys: LoosePickup[];
  score: ScoreState;
  director: DirectorState;
  scent: ScentField;
  noise: { x: number; y: number; loudness: number; age: number } | null;
  outcome: StageOutcome;
  result: StageResult | null;
  hints: AiHints;
  spotted: boolean;
}

function center(x: number, y: number): { x: number; y: number } {
  return {
    x: Number.isInteger(x) ? x + 0.5 : x,
    y: Number.isInteger(y) ? y + 0.5 : y,
  };
}

function isPowerUpKind(value: string | undefined): value is PowerUpKind {
  return (
    value === 'speed' ||
    value === 'invisibility' ||
    value === 'freeze' ||
    value === 'decoy' ||
    value === 'extraLife' ||
    value === 'noiseBomb' ||
    value === 'magnet' ||
    value === 'featherFoot' ||
    value === 'scentMask' ||
    value === 'timeSlip'
  );
}

function isHazardKind(value: string | undefined): value is HazardKind {
  return (
    value === 'snapTrap' ||
    value === 'glueBoard' ||
    value === 'water' ||
    value === 'fan' ||
    value === 'broom' ||
    value === 'vacuum' ||
    value === 'sparkWire'
  );
}

export function loadStage(def: StageDef, difficulty = def.difficulty, seed = def.seed): LoadedStage {
  const rng = makeRng(seed);
  const world = new World();
  const tiles = tilesFromRows(def.tiles, def.width, def.height, def.tileSize);
  const spawn = center(def.spawn.x, def.spawn.y);
  const mouse = createMouse(world.create(), spawn.x, spawn.y, mouseStatsForDifficulty(difficulty), def.lives);

  const patrolById = new Map<number, { x: number; y: number }[]>();
  for (const route of def.patrols) {
    patrolById.set(
      route.id,
      route.points.map((p) => center(p.x, p.y)),
    );
  }

  const cats: CatRuntime[] = [];
  const cheeses: CheeseRuntime[] = [];
  const holes: HoleRuntime[] = [];
  const hazards: HazardRuntime[] = [];
  const powerUps: PowerUpRuntime[] = [];
  const lights: LightRuntime[] = [];
  const switches: SwitchRuntime[] = [];
  const doors: DoorRuntime[] = [];
  const crumbs: CrumbPickup[] = [];
  const keys: LoosePickup[] = [];

  const hints: AiHints = {
    ambushSpots: def.hints.ambushSpots.map((p) => center(p.x, p.y)),
    searchSpots: def.hints.searchSpots.map((p) => center(p.x, p.y)),
    aggression: def.hints.aggression,
    scentBias: def.hints.scentBias,
    hearingBias: def.hints.hearingBias,
    campHoleChance: def.hints.campHoleChance,
    leashRadius: def.hints.leashRadius,
  };

  for (const spawnEnt of def.entities) {
    placeEntity(world, spawnEnt, {
      cats,
      cheeses,
      holes,
      hazards,
      powerUps,
      switches,
      doors,
      crumbs,
      keys,
      patrolById,
      difficulty,
      hints,
      rngAggression: def.hints.aggression,
    });
  }

  for (const light of def.lights) {
    const pos = center(light.x, light.y);
    lights.push({
      entity: world.create(),
      x: pos.x,
      y: pos.y,
      radius: light.radius,
      intensity: light.intensity,
      on: light.on !== false,
      switchId: light.switchId ?? '',
      color: light.color ?? '#ffe8a3',
    });
  }

  seedHolesFromTiles(world, tiles, holes);
  seedDoorsFromTiles(world, tiles, doors);

  for (const door of doors) {
    if (door.open && !door.locked) tiles.setDoorOpen(Math.floor(door.x), Math.floor(door.y), true);
  }

  for (const sw of switches) {
    if (!sw.on) continue;
    for (const light of lights) {
      if (light.switchId && (sw.targets.includes(light.switchId) || light.switchId === sw.id)) light.on = true;
    }
  }

  if (holes.length === 0) {
    holes.push(createHole(world.create(), spawn.x, spawn.y, true, -1, HOLE_RADIUS));
  }

  void rng;

  return {
    def,
    world,
    tiles,
    mouse,
    cats,
    cheeses,
    holes,
    hazards,
    powerUps,
    decoys: [],
    lights,
    switches,
    doors,
    crumbs,
    keys,
    score: createScoreState(def.quota),
    director: createDirector(def.index),
    scent: new ScentField(def.width, def.height),
    noise: null,
    outcome: 'playing',
    result: null,
    hints,
    spotted: false,
  };
}

interface PlaceSink {
  cats: CatRuntime[];
  cheeses: CheeseRuntime[];
  holes: HoleRuntime[];
  hazards: HazardRuntime[];
  powerUps: PowerUpRuntime[];
  switches: SwitchRuntime[];
  doors: DoorRuntime[];
  crumbs: CrumbPickup[];
  keys: LoosePickup[];
  patrolById: Map<number, { x: number; y: number }[]>;
  difficulty: number;
  hints: AiHints;
  rngAggression: number;
}

function placeEntity(world: World, spawn: EntitySpawn, sink: PlaceSink): void {
  const pos = center(spawn.x, spawn.y);
  switch (spawn.type) {
    case 'cat': {
      const kit = breedKit(spawn.breed);
      const stats = scaleCatStats(kit.stats, sink.difficulty, sink.rngAggression);
      const patrol = spawn.patrol !== undefined ? sink.patrolById.get(spawn.patrol) ?? [] : [];
      const cat = createCat(
        world.create(),
        pos.x,
        pos.y,
        kit.id,
        patrol,
        sink.hints.searchSpots.map((s) => ({ x: s.x, y: s.y })),
        stats,
        kit.weights,
      );
      if (spawn.facing !== undefined) cat.transform.facing = spawn.facing;
      sink.cats.push(cat);
      break;
    }
    case 'cheese':
      sink.cheeses.push(createCheese(world.create(), pos.x, pos.y, spawn.value ?? 1, spawn.guarded === true));
      break;
    case 'hole':
      sink.holes.push(createHole(world.create(), pos.x, pos.y, true, -1));
      break;
    case 'hazard':
      if (isHazardKind(spawn.kind)) {
        sink.hazards.push(createHazard(world.create(), spawn.kind, pos.x, pos.y, spawn.facing ?? 0));
      }
      break;
    case 'powerUp':
      if (isPowerUpKind(spawn.kind)) {
        sink.powerUps.push(createPowerUp(world.create(), spawn.kind, pos.x, pos.y, 0));
      }
      break;
    case 'switch':
      sink.switches.push({
        entity: world.create(),
        id: spawn.id ?? `switch-${spawn.x}-${spawn.y}`,
        x: pos.x,
        y: pos.y,
        on: false,
        targets: [...(spawn.targets ?? [])],
        kind: 'light',
      });
      break;
    case 'door':
      sink.doors.push({
        entity: world.create(),
        id: spawn.id ?? `door-${spawn.x}-${spawn.y}`,
        x: pos.x,
        y: pos.y,
        w: 1,
        h: 1,
        open: spawn.locked !== true,
        locked: spawn.locked === true,
        keyId: spawn.keyId ?? '',
      });
      break;
    case 'crumb':
      sink.crumbs.push({ entity: world.create(), x: pos.x, y: pos.y, taken: false });
      break;
    case 'key':
      sink.keys.push({
        entity: world.create(),
        x: pos.x,
        y: pos.y,
        taken: false,
        keyId: spawn.keyId ?? spawn.id ?? 'key',
      });
      break;
    default:
      break;
  }
}

function seedHolesFromTiles(world: World, tiles: GameTileMap, holes: HoleRuntime[]): void {
  for (let ty = 0; ty < tiles.height; ty += 1) {
    for (let tx = 0; tx < tiles.width; tx += 1) {
      if (tiles.at(tx, ty) !== 'hole') continue;
      const x = tx + 0.5;
      const y = ty + 0.5;
      const exists = holes.some((h) => Math.floor(h.x) === tx && Math.floor(h.y) === ty);
      if (!exists) holes.push(createHole(world.create(), x, y, true, -1));
    }
  }
}

function seedDoorsFromTiles(world: World, tiles: GameTileMap, doors: DoorRuntime[]): void {
  for (let ty = 0; ty < tiles.height; ty += 1) {
    for (let tx = 0; tx < tiles.width; tx += 1) {
      if (tiles.at(tx, ty) !== 'door') continue;
      const exists = doors.some((d) => Math.floor(d.x) === tx && Math.floor(d.y) === ty);
      if (!exists) {
        doors.push({
          entity: world.create(),
          id: `tile-door-${tx}-${ty}`,
          x: tx + 0.5,
          y: ty + 0.5,
          w: 1,
          h: 1,
          open: false,
          locked: false,
          keyId: '',
        });
      }
    }
  }
}

export function allocateOn(stage: LoadedStage): Entity {
  return stage.world.create();
}
