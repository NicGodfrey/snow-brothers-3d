/**
 * Content schema. Stage modules under `src/content/stages/**` are plain data
 * that must satisfy `StageDef`; loaders in `src/game` turn them into runtime.
 */

import type { TileKind } from '../engine/types';
import type { CatStats, HazardKind, PowerUpKind } from '../game/types';

export type ThemeId =
  | 'cellar'
  | 'kitchen'
  | 'alley'
  | 'sewer'
  | 'attic'
  | 'carnival'
  | 'museum'
  | 'subway'
  | 'docks'
  | 'greenhouse'
  | 'clocktower'
  | 'moonLab';

export const THEME_IDS: readonly ThemeId[] = [
  'cellar',
  'kitchen',
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

/** Single-character legend used by the tile rows of a stage. */
export type TileGlyph =
  | ' '
  | '.'
  | '#'
  | 'X'
  | 'T'
  | '~'
  | 'g'
  | 'v'
  | 'o'
  | 'D'
  | '_'
  | 'r'
  | 'G'
  | 'p'
  | 's'
  | 'L';

export const TILE_LEGEND: Readonly<Record<TileGlyph, TileKind>> = {
  ' ': 'void',
  '.': 'floor',
  '#': 'wall',
  X: 'crate',
  T: 'table',
  '~': 'water',
  g: 'grate',
  v: 'vent',
  o: 'hole',
  D: 'door',
  _: 'oneWay',
  r: 'rug',
  G: 'glass',
  p: 'pipe',
  s: 'stairs',
  L: 'ledge',
};

export interface PaletteDef {
  readonly id: ThemeId;
  readonly name: string;
  readonly background: string;
  readonly floor: string;
  readonly floorAlt: string;
  readonly wall: string;
  readonly wallShade: string;
  readonly accent: string;
  readonly prop: string;
  readonly liquid: string;
  readonly light: string;
  readonly fog: string;
  readonly ambientLight: number;
}

export interface EntitySpawn {
  readonly type:
    | 'cheese'
    | 'cat'
    | 'powerUp'
    | 'hazard'
    | 'switch'
    | 'door'
    | 'hole'
    | 'crumb'
    | 'key'
    | 'decorProp';
  readonly x: number;
  readonly y: number;
  readonly id?: string;
  readonly breed?: string;
  readonly value?: number;
  readonly kind?: PowerUpKind | HazardKind;
  readonly patrol?: number;
  readonly guarded?: boolean;
  readonly locked?: boolean;
  readonly keyId?: string;
  readonly targets?: readonly string[];
  readonly facing?: number;
  readonly note?: string;
}

export interface LightDef {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly intensity: number;
  readonly color?: string;
  readonly switchId?: string;
  readonly on?: boolean;
  readonly flicker?: number;
}

export interface PatrolRoute {
  readonly id: number;
  readonly loop: boolean;
  readonly pauseSeconds: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

export interface DialogueBeat {
  readonly at: 'enter' | 'firstCheese' | 'firstSpotted' | 'halfQuota' | 'lowLives' | 'win' | 'lose' | 'idle';
  readonly speaker: 'Squeak' | 'Pounce' | 'Narrator' | 'Gran' | 'Radio';
  readonly line: string;
  readonly delay?: number;
}

export interface AiHints {
  /** Preferred ambush tiles for the cat. */
  readonly ambushSpots: readonly { readonly x: number; readonly y: number }[];
  /** Spots the cat checks when searching. */
  readonly searchSpots: readonly { readonly x: number; readonly y: number }[];
  /** Cat aggression multiplier applied on top of breed stats. */
  readonly aggression: number;
  /** How strongly the cat trusts scent on this stage. */
  readonly scentBias: number;
  /** How strongly the cat trusts hearing on this stage. */
  readonly hearingBias: number;
  /** Chance per search cycle that the cat guards the hole instead. */
  readonly campHoleChance: number;
  readonly leashRadius: number;
}

export interface StageObjective {
  readonly kind: 'quota' | 'timeLimit' | 'noCatch' | 'allCheese' | 'reachExit' | 'pacifist';
  readonly value: number;
  readonly optional: boolean;
  readonly label: string;
}

export interface StageDef {
  readonly id: string;
  readonly chapter: number;
  readonly index: number;
  readonly name: string;
  readonly theme: ThemeId;
  readonly kind: 'story' | 'arcade' | 'timeAttack';
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** Row strings of `TileGlyph`; length must equal `height`, each `width`. */
  readonly tiles: readonly string[];
  /** Purely visual layer; same dimensions as `tiles`. */
  readonly decor: readonly string[];
  readonly spawn: { readonly x: number; readonly y: number };
  readonly entities: readonly EntitySpawn[];
  readonly lights: readonly LightDef[];
  readonly patrols: readonly PatrolRoute[];
  readonly dialogue: readonly DialogueBeat[];
  readonly hints: AiHints;
  readonly objectives: readonly StageObjective[];
  readonly quota: number;
  readonly parTime: number;
  readonly lives: number;
  readonly ambient: number;
  readonly difficulty: number;
  readonly music: string;
  readonly tags: readonly string[];
}

export interface ChapterDef {
  readonly index: number;
  readonly title: string;
  readonly theme: ThemeId;
  readonly blurb: string;
  readonly stageIds: readonly string[];
  readonly unlockAfter: number;
}

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly kind: PowerUpKind;
  readonly duration: number;
  readonly magnitude: number;
  readonly rarity: number;
  readonly description: string;
  readonly color: string;
}

export interface BreedDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly color: string;
  readonly stats: CatStats;
  /** Behaviour weights consumed by the cat brain when choosing a plan. */
  readonly weights: {
    readonly patrol: number;
    readonly ambush: number;
    readonly camp: number;
    readonly wander: number;
    readonly nap: number;
  };
}

export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly target: number;
  readonly hidden: boolean;
  readonly metric:
    | 'cheeseTotal'
    | 'stagesCleared'
    | 'noCatchClears'
    | 'dashCount'
    | 'decoyCount'
    | 'powerUpsUsed'
    | 'chapterCleared'
    | 'comboBest'
    | 'timeAttackBest'
    | 'catsFrozen';
}

export interface DialogueNode {
  readonly id: string;
  readonly speaker: string;
  readonly line: string;
  readonly next?: string;
  readonly choices?: readonly { readonly label: string; readonly next: string }[];
}

export interface DialogueTree {
  readonly id: string;
  readonly root: string;
  readonly nodes: readonly DialogueNode[];
}
