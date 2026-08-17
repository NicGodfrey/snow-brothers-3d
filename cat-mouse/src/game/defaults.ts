import type { CatStats, CatWeights, MouseStats, PowerUpKind } from './types';

export const MOUSE_RADIUS = 0.28;
export const CAT_RADIUS = 0.38;
export const CHEESE_RADIUS = 0.32;
export const HOLE_RADIUS = 0.55;
export const PICKUP_RADIUS = 0.42;
export const INTERACT_RADIUS = 0.7;

export const CATCH_INVULN = 1.55;
export const COMBO_WINDOW = 3.25;
export const DASH_IFRAMES = 0;
export const NOISE_EMIT_THRESHOLD = 0.045;
export const SCENT_IDLE = 0.04;
export const HIDE_CATCH_GRACE = true;

export const DEFAULT_MOUSE_STATS: MouseStats = {
  walkSpeed: 2.55,
  sneakSpeed: 1.18,
  dashSpeed: 5.4,
  dashSeconds: 0.22,
  dashCooldown: 0.55,
  staminaMax: 1,
  staminaRegen: 0.42,
  staminaDashCost: 0.34,
  carryPenalty: 0.16,
  noiseWalk: 0.38,
  noiseSneak: 0.08,
  noiseDash: 1.15,
  scentWalk: 0.55,
  scentSneak: 0.12,
};

export const DEFAULT_CAT_STATS: CatStats = {
  patrolSpeed: 1.55,
  investigateSpeed: 2.05,
  // Deliberately under the mouse walk speed (2.55). A cat that is faster in a
  // straight line makes every sighting a guaranteed catch; the threat is meant
  // to come from the pounce burst and from cutoffs. A full load (2.14) still
  // cannot outrun this, so carrying stays a real risk.
  chaseSpeed: 2.3,
  pounceSpeed: 6.2,
  turnRate: 7.5,
  sightRange: 7.4,
  sightHalfAngle: (36 * Math.PI) / 180,
  peripheralRange: 2.6,
  hearingRange: 8.5,
  scentSensitivity: 1,
  suspicionGain: 0.85,
  suspicionDecay: 0.28,
  memorySeconds: 2.4,
  pounceRange: 1.85,
  pounceCooldown: 1.6,
  searchSeconds: 5.5,
  napChance: 0.12,
};

export const DEFAULT_CAT_WEIGHTS: CatWeights = {
  patrol: 1,
  ambush: 0.28,
  camp: 0.18,
  wander: 0.22,
  nap: 0.14,
};

export interface BreedKit {
  readonly id: string;
  readonly name: string;
  readonly stats: CatStats;
  readonly weights: CatWeights;
}

function kit(
  id: string,
  name: string,
  stats: Partial<CatStats>,
  weights: Partial<CatWeights>,
): BreedKit {
  return {
    id,
    name,
    stats: { ...DEFAULT_CAT_STATS, ...stats },
    weights: { ...DEFAULT_CAT_WEIGHTS, ...weights },
  };
}

/** Distinct hunter kits. Numbers are gameplay-tuned, not reskins of one row. */
export const BREED_KITS: Readonly<Record<string, BreedKit>> = {
  tabby: kit('tabby', 'Tabby', {}, {}),
  siamese: kit(
    'siamese',
    'Siamese',
    {
      patrolSpeed: 1.7,
      chaseSpeed: 3.2,
      sightRange: 8.6,
      sightHalfAngle: (28 * Math.PI) / 180,
      hearingRange: 7.2,
      suspicionGain: 1.05,
      napChance: 0.05,
      pounceRange: 2.05,
    },
    { patrol: 0.7, ambush: 0.15, camp: 0.1, wander: 0.35, nap: 0.05 },
  ),
  persian: kit(
    'persian',
    'Persian',
    {
      patrolSpeed: 1.15,
      investigateSpeed: 1.45,
      chaseSpeed: 2.15,
      pounceSpeed: 4.6,
      turnRate: 5.2,
      sightRange: 6.2,
      hearingRange: 6.4,
      scentSensitivity: 1.35,
      suspicionGain: 0.55,
      suspicionDecay: 0.4,
      napChance: 0.38,
      searchSeconds: 3.6,
    },
    { patrol: 0.6, ambush: 0.2, camp: 0.25, wander: 0.1, nap: 0.55 },
  ),
  bengal: kit(
    'bengal',
    'Bengal',
    {
      patrolSpeed: 1.9,
      investigateSpeed: 2.5,
      chaseSpeed: 3.45,
      pounceSpeed: 7.1,
      turnRate: 9.2,
      sightRange: 7.0,
      hearingRange: 7.8,
      suspicionGain: 1.15,
      memorySeconds: 1.7,
      pounceRange: 2.35,
      pounceCooldown: 1.15,
      napChance: 0.04,
    },
    { patrol: 0.55, ambush: 0.45, camp: 0.08, wander: 0.4, nap: 0.04 },
  ),
  maineCoon: kit(
    'maineCoon',
    'Maine Coon',
    {
      patrolSpeed: 1.42,
      chaseSpeed: 2.6,
      pounceSpeed: 5.5,
      sightRange: 6.8,
      hearingRange: 10.4,
      scentSensitivity: 1.55,
      suspicionGain: 0.7,
      memorySeconds: 3.2,
      searchSeconds: 7.2,
      napChance: 0.16,
    },
    { patrol: 1.1, ambush: 0.22, camp: 0.32, wander: 0.18, nap: 0.18 },
  ),
  bombay: kit(
    'bombay',
    'Bombay',
    {
      patrolSpeed: 1.35,
      investigateSpeed: 1.9,
      chaseSpeed: 3.05,
      pounceSpeed: 6.8,
      sightRange: 5.6,
      sightHalfAngle: (42 * Math.PI) / 180,
      peripheralRange: 3.1,
      hearingRange: 7.6,
      suspicionGain: 0.95,
      pounceRange: 2.2,
      napChance: 0.08,
    },
    { patrol: 0.45, ambush: 0.85, camp: 0.4, wander: 0.12, nap: 0.08 },
  ),
  sphynx: kit(
    'sphynx',
    'Sphynx',
    {
      patrolSpeed: 1.62,
      chaseSpeed: 2.95,
      turnRate: 10.4,
      sightRange: 8.1,
      hearingRange: 9.2,
      suspicionGain: 1.35,
      suspicionDecay: 0.18,
      memorySeconds: 2.9,
      napChance: 0.03,
      searchSeconds: 6.4,
    },
    { patrol: 0.9, ambush: 0.2, camp: 0.15, wander: 0.5, nap: 0.03 },
  ),
  ragdoll: kit(
    'ragdoll',
    'Ragdoll',
    {
      patrolSpeed: 1.05,
      investigateSpeed: 1.35,
      chaseSpeed: 2.05,
      pounceSpeed: 4.2,
      turnRate: 4.4,
      sightRange: 5.8,
      hearingRange: 5.5,
      scentSensitivity: 0.75,
      suspicionGain: 0.42,
      suspicionDecay: 0.5,
      pounceRange: 1.45,
      napChance: 0.48,
      searchSeconds: 3.2,
    },
    { patrol: 0.5, ambush: 0.12, camp: 0.2, wander: 0.08, nap: 0.7 },
  ),
  scottishFold: kit(
    'scottishFold',
    'Scottish Fold',
    {
      patrolSpeed: 1.5,
      investigateSpeed: 1.85,
      chaseSpeed: 2.55,
      sightRange: 7.1,
      hearingRange: 8.0,
      scentSensitivity: 1.1,
      suspicionGain: 0.78,
      memorySeconds: 2.6,
      napChance: 0.2,
    },
    { patrol: 1.4, ambush: 0.18, camp: 0.22, wander: 0.1, nap: 0.2 },
  ),
  orange: kit(
    'orange',
    'Orange',
    {
      patrolSpeed: 1.75,
      investigateSpeed: 2.2,
      chaseSpeed: 3.1,
      pounceSpeed: 6.6,
      turnRate: 6.1,
      sightRange: 6.5,
      hearingRange: 8.8,
      suspicionGain: 0.92,
      suspicionDecay: 0.22,
      pounceRange: 1.7,
      napChance: 0.22,
      searchSeconds: 4.4,
    },
    { patrol: 0.6, ambush: 0.3, camp: 0.12, wander: 0.85, nap: 0.25 },
  ),
  tuxedo: kit(
    'tuxedo',
    'Tuxedo',
    {
      patrolSpeed: 1.48,
      chaseSpeed: 2.92,
      sightRange: 7.8,
      sightHalfAngle: (30 * Math.PI) / 180,
      peripheralRange: 2.1,
      hearingRange: 7.4,
      scentSensitivity: 0.9,
      suspicionGain: 0.88,
      memorySeconds: 2.1,
      pounceRange: 1.95,
      napChance: 0.09,
    },
    { patrol: 0.8, ambush: 0.5, camp: 0.28, wander: 0.16, nap: 0.09 },
  ),
  calico: kit(
    'calico',
    'Calico',
    {
      patrolSpeed: 1.58,
      investigateSpeed: 2.35,
      chaseSpeed: 2.7,
      sightRange: 7.2,
      hearingRange: 9.0,
      scentSensitivity: 1.25,
      suspicionGain: 0.8,
      memorySeconds: 3.4,
      searchSeconds: 6.8,
      napChance: 0.14,
    },
    { patrol: 0.95, ambush: 0.25, camp: 0.18, wander: 0.3, nap: 0.14 },
  ),
  pounce: kit(
    'pounce',
    'Pounce',
    {
      patrolSpeed: 1.6,
      investigateSpeed: 2.15,
      chaseSpeed: 3.0,
      pounceSpeed: 6.5,
      turnRate: 8.0,
      sightRange: 7.6,
      napChance: 0.1,
    },
    { patrol: 1, ambush: 0.32, camp: 0.2, wander: 0.2, nap: 0.1 },
  ),
};

export const DEFAULT_BREED = 'tabby';

export function breedKit(id: string | undefined | null): BreedKit {
  if (id && BREED_KITS[id]) return BREED_KITS[id] as BreedKit;
  return BREED_KITS[DEFAULT_BREED] as BreedKit;
}

export function cloneMouseStats(base: MouseStats = DEFAULT_MOUSE_STATS): MouseStats {
  return { ...base };
}

export function cloneCatStats(base: CatStats = DEFAULT_CAT_STATS): CatStats {
  return { ...base };
}

export function cloneCatWeights(base: CatWeights = DEFAULT_CAT_WEIGHTS): CatWeights {
  return { ...base };
}

export function scaleCatStats(stats: CatStats, difficulty: number, aggression = 1): CatStats {
  const d = Math.max(0.35, difficulty);
  const a = Math.max(0.4, aggression);
  return {
    patrolSpeed: stats.patrolSpeed * (0.88 + 0.12 * d),
    investigateSpeed: stats.investigateSpeed * (0.86 + 0.14 * d),
    chaseSpeed: stats.chaseSpeed * (0.82 + 0.18 * d) * (0.92 + 0.08 * a),
    pounceSpeed: stats.pounceSpeed * (0.9 + 0.1 * d),
    turnRate: stats.turnRate * (0.9 + 0.1 * a),
    sightRange: stats.sightRange * (0.88 + 0.12 * d),
    sightHalfAngle: stats.sightHalfAngle,
    peripheralRange: stats.peripheralRange * (0.9 + 0.1 * d),
    hearingRange: stats.hearingRange * (0.9 + 0.1 * d),
    scentSensitivity: stats.scentSensitivity * (0.85 + 0.15 * a),
    suspicionGain: stats.suspicionGain * d * a,
    suspicionDecay: stats.suspicionDecay / Math.sqrt(d),
    memorySeconds: stats.memorySeconds * (0.9 + 0.1 * a),
    pounceRange: stats.pounceRange * (0.94 + 0.06 * d),
    pounceCooldown: stats.pounceCooldown / (0.85 + 0.15 * d),
    searchSeconds: stats.searchSeconds * (0.9 + 0.12 * d),
    napChance: stats.napChance / (0.55 + 0.45 * d),
  };
}

export function mouseStatsForDifficulty(difficulty: number): MouseStats {
  const d = Math.max(0.35, difficulty);
  const stats = cloneMouseStats();
  stats.walkSpeed *= 1.08 - 0.06 * Math.min(d, 2);
  stats.staminaRegen *= 1.12 - 0.1 * Math.min(d, 2);
  stats.noiseWalk *= 0.92 + 0.08 * d;
  return stats;
}

export interface PowerUpProfile {
  readonly kind: PowerUpKind;
  readonly duration: number;
  readonly magnitude: number;
  readonly autoUse: boolean;
}

export const POWER_UP_PROFILES: Readonly<Record<PowerUpKind, PowerUpProfile>> = {
  speed: { kind: 'speed', duration: 4.2, magnitude: 0.42, autoUse: false },
  invisibility: { kind: 'invisibility', duration: 3.6, magnitude: 1, autoUse: false },
  freeze: { kind: 'freeze', duration: 2.8, magnitude: 1, autoUse: false },
  decoy: { kind: 'decoy', duration: 5.5, magnitude: 1.6, autoUse: false },
  extraLife: { kind: 'extraLife', duration: 0, magnitude: 1, autoUse: true },
  noiseBomb: { kind: 'noiseBomb', duration: 0.4, magnitude: 8.5, autoUse: false },
  magnet: { kind: 'magnet', duration: 6.5, magnitude: 2.6, autoUse: false },
  featherFoot: { kind: 'featherFoot', duration: 7.5, magnitude: 0.28, autoUse: false },
  scentMask: { kind: 'scentMask', duration: 8, magnitude: 1, autoUse: false },
  timeSlip: { kind: 'timeSlip', duration: 2.4, magnitude: 0.55, autoUse: false },
};

export const HAZARD_RADIUS: Readonly<Record<string, number>> = {
  snapTrap: 0.38,
  glueBoard: 0.55,
  water: 0.7,
  fan: 1.35,
  broom: 1.1,
  vacuum: 1.6,
  sparkWire: 0.42,
};

export const HAZARD_COOLDOWN: Readonly<Record<string, number>> = {
  snapTrap: 4.5,
  glueBoard: 0,
  water: 0,
  fan: 0,
  broom: 1.8,
  vacuum: 0,
  sparkWire: 1.35,
};
