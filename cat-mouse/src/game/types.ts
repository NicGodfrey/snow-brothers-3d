/**
 * Gameplay contracts. Depends on engine types only; content data is described
 * in `src/content/schema.ts` and converted into these runtime shapes.
 */

import type { Entity, Rng, Vec2 } from '../engine/types';

export type GameMode = 'story' | 'arcade' | 'timeAttack' | 'mirror' | 'hotseat' | 'sandbox';

export type Team = 'mouse' | 'cat' | 'neutral';

export type MouseStance = 'idle' | 'walk' | 'sneak' | 'dash' | 'carry' | 'stunned' | 'caught';

export type CatState =
  | 'patrol'
  | 'suspicious'
  | 'investigate'
  | 'chase'
  | 'pounce'
  | 'search'
  | 'ambush'
  | 'groom'
  | 'nap'
  | 'return';

export type PowerUpKind =
  | 'speed'
  | 'invisibility'
  | 'freeze'
  | 'decoy'
  | 'extraLife'
  | 'noiseBomb'
  | 'magnet'
  | 'featherFoot'
  | 'scentMask'
  | 'timeSlip';

export type StatusEffectKind =
  | 'hasted'
  | 'slowed'
  | 'invisible'
  | 'frozen'
  | 'stunned'
  | 'blinded'
  | 'deafened'
  | 'scentless'
  | 'magnetized'
  | 'invulnerable'
  | 'exhausted'
  | 'enraged';

export type ItemKind =
  | 'cheese'
  | 'crumb'
  | 'key'
  | 'coin'
  | 'powerUp'
  | 'trapPart'
  | 'yarn'
  | 'bell';

export type HazardKind = 'snapTrap' | 'glueBoard' | 'water' | 'fan' | 'broom' | 'vacuum' | 'sparkWire';

export interface Transform {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  radius: number;
}

export interface MouseStats {
  walkSpeed: number;
  sneakSpeed: number;
  dashSpeed: number;
  dashSeconds: number;
  dashCooldown: number;
  staminaMax: number;
  staminaRegen: number;
  staminaDashCost: number;
  carryPenalty: number;
  noiseWalk: number;
  noiseSneak: number;
  noiseDash: number;
  scentWalk: number;
  scentSneak: number;
}

export interface MouseRuntime {
  entity: Entity;
  transform: Transform;
  stance: MouseStance;
  stats: MouseStats;
  stamina: number;
  dashTimer: number;
  dashCooldown: number;
  invulnerable: number;
  carrying: number;
  carryCapacity: number;
  crumbs: number;
  keys: string[];
  heldPowerUp: PowerUpKind | null;
  lives: number;
  spawnX: number;
  spawnY: number;
  lastNoise: number;
}

export interface CatStats {
  patrolSpeed: number;
  investigateSpeed: number;
  chaseSpeed: number;
  pounceSpeed: number;
  turnRate: number;
  sightRange: number;
  sightHalfAngle: number;
  peripheralRange: number;
  hearingRange: number;
  scentSensitivity: number;
  suspicionGain: number;
  suspicionDecay: number;
  memorySeconds: number;
  pounceRange: number;
  pounceCooldown: number;
  searchSeconds: number;
  napChance: number;
}

export interface CatRuntime {
  entity: Entity;
  transform: Transform;
  state: CatState;
  breed: string;
  stats: CatStats;
  suspicion: number;
  stateTimer: number;
  pounceCooldown: number;
  frozen: number;
  target: Vec2 | null;
  lastKnown: Vec2 | null;
  memoryTimer: number;
  patrolRoute: Vec2[];
  patrolIndex: number;
  path: Vec2[];
  pathIndex: number;
  repathTimer: number;
  searchSpots: Vec2[];
  homeX: number;
  homeY: number;
}

export interface StatusEffect {
  kind: StatusEffectKind;
  remaining: number;
  magnitude: number;
  source: string;
}

export interface CheeseRuntime {
  entity: Entity;
  x: number;
  y: number;
  value: number;
  taken: boolean;
  guarded: boolean;
}

export interface HoleRuntime {
  entity: Entity;
  x: number;
  y: number;
  radius: number;
  isExit: boolean;
  linkedTo: number;
}

export interface HazardRuntime {
  entity: Entity;
  kind: HazardKind;
  x: number;
  y: number;
  radius: number;
  armed: boolean;
  cooldown: number;
  noise: number;
}

export interface PowerUpRuntime {
  entity: Entity;
  kind: PowerUpKind;
  x: number;
  y: number;
  taken: boolean;
  respawn: number;
}

export interface DecoyRuntime {
  entity: Entity;
  x: number;
  y: number;
  life: number;
  noise: number;
  attracted: boolean;
}

export interface LightRuntime {
  entity: Entity;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  on: boolean;
  switchId: string;
  color: string;
}

export interface SwitchRuntime {
  entity: Entity;
  id: string;
  x: number;
  y: number;
  on: boolean;
  targets: string[];
  kind: 'light' | 'door' | 'fan' | 'vent';
}

export interface DoorRuntime {
  entity: Entity;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
  locked: boolean;
  keyId: string;
}

export interface ScoreState {
  cheeseBanked: number;
  cheeseCarried: number;
  quota: number;
  score: number;
  combo: number;
  comboTimer: number;
  bestCombo: number;
  heat: number;
  stealthBonus: number;
  timeSeconds: number;
  catches: number;
  stars: number;
}

export interface DirectorState {
  intensity: number;
  targetIntensity: number;
  restTimer: number;
  waveIndex: number;
  spawnBudget: number;
  lastEvent: string;
  escalation: number;
}

export type StageOutcome = 'playing' | 'won' | 'lost' | 'aborted';

export interface StageResult {
  outcome: StageOutcome;
  stageId: string;
  score: number;
  timeSeconds: number;
  cheeseBanked: number;
  quota: number;
  catches: number;
  stars: number;
  noCatch: boolean;
}

export interface GameEventMap {
  'mouse:noise': { x: number; y: number; loudness: number };
  'mouse:caught': { x: number; y: number; livesLeft: number };
  'mouse:dash': { x: number; y: number };
  'mouse:respawn': { x: number; y: number };
  'cheese:taken': { x: number; y: number; value: number };
  'cheese:banked': { total: number; quota: number; combo: number };
  'cat:stateChange': { from: CatState; to: CatState; breed: string };
  'cat:spotted': { x: number; y: number };
  'cat:lost': { x: number; y: number };
  'powerUp:taken': { kind: PowerUpKind };
  'powerUp:used': { kind: PowerUpKind };
  'hazard:triggered': { kind: HazardKind; x: number; y: number };
  'stage:won': StageResult;
  'stage:lost': StageResult;
  'dialogue:beat': { speaker: string; line: string };
  'achievement:unlocked': { id: string };
}

export type GameEventTopic = keyof GameEventMap;

export interface SimulationOptions {
  rng: Rng;
  mode: GameMode;
  difficulty: number;
  seed: number;
}
