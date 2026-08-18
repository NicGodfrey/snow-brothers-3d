import type { ItemDef } from './schema';
import type { PowerUpKind } from '../game/types';

export const ITEMS: readonly ItemDef[] = [
  {
    id: 'pepper-dash',
    name: 'Pepper Dash',
    kind: 'speed',
    duration: 6.5,
    magnitude: 1.55,
    rarity: 0.22,
    description: 'A stolen pinch of cracked pepper. Legs blur, crumbs scatter, and the cat has to guess which smear is you.',
    color: '#e85a2a',
  },
  {
    id: 'flour-cloak',
    name: 'Flour Cloak',
    kind: 'invisibility',
    duration: 5.0,
    magnitude: 1,
    rarity: 0.14,
    description: 'Roll through the spilled bag and become a moving puff. Sight cones pass through; scent still tattles if you run.',
    color: '#f4efe4',
  },
  {
    id: 'ice-cube',
    name: 'Ice Cube',
    kind: 'freeze',
    duration: 3.8,
    magnitude: 1,
    rarity: 0.12,
    description: 'Flick a chip of freezer ice under a paw. The hunter locks mid-stride, whiskers glittering, for a precious few seconds.',
    color: '#8ad4f0',
  },
  {
    id: 'yarn-ghost',
    name: 'Yarn Ghost',
    kind: 'decoy',
    duration: 7.2,
    magnitude: 1.2,
    rarity: 0.2,
    description: 'A wound scrap of red yarn that skitters like prey. Cats that love ambush waste a whole search cycle on it.',
    color: '#d43040',
  },
  {
    id: 'second-chance',
    name: 'Second Chance',
    kind: 'extraLife',
    duration: 0,
    magnitude: 1,
    rarity: 0.06,
    description: 'Gran\'s spare thimble, worn as a helmet. One catch that should have ended the raid instead dumps you back at the hole.',
    color: '#f0d060',
  },
  {
    id: 'lid-clang',
    name: 'Lid Clang',
    kind: 'noiseBomb',
    duration: 0.6,
    magnitude: 2.4,
    rarity: 0.18,
    description: 'A bottle cap flicked into a metal bowl. Every cat in earshot abandons the current plan and sprints toward the racket.',
    color: '#c0c8d0',
  },
  {
    id: 'cheddar-pull',
    name: 'Cheddar Pull',
    kind: 'magnet',
    duration: 8.0,
    magnitude: 3.2,
    rarity: 0.16,
    description: 'A rind so sharp it tugs nearby wedges across the floor. Bank faster, but the rolling cheese is loud.',
    color: '#f0b430',
  },
  {
    id: 'felt-socks',
    name: 'Felt Socks',
    kind: 'featherFoot',
    duration: 9.5,
    magnitude: 0.35,
    rarity: 0.19,
    description: 'Two postage stamps stuck to the pads. Footstep noise drops to a rumour and sneak speed barely suffers.',
    color: '#a08060',
  },
  {
    id: 'herb-rub',
    name: 'Herb Rub',
    kind: 'scentMask',
    duration: 10.0,
    magnitude: 0.15,
    rarity: 0.17,
    description: 'Crushed mint and dust. The trail you leave smells like the cupboard you came from, which is everywhere.',
    color: '#68a048',
  },
  {
    id: 'stopped-watch',
    name: 'Stopped Watch',
    kind: 'timeSlip',
    duration: 4.2,
    magnitude: 0.45,
    rarity: 0.08,
    description: 'A clocktower splinter that makes patrols wade. Your dash still costs stamina; theirs costs molasses.',
    color: '#70d0d8',
  },
];

export const ITEM_BY_KIND: Readonly<Record<PowerUpKind, ItemDef>> = Object.fromEntries(
  ITEMS.map((item) => [item.kind, item]),
) as Record<PowerUpKind, ItemDef>;

export const ITEM_BY_ID: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item]),
);

export const POWER_UP_SPAWN_WEIGHTS: Readonly<Record<PowerUpKind, number>> = {
  speed: 1.2,
  invisibility: 0.7,
  freeze: 0.65,
  decoy: 1.1,
  extraLife: 0.25,
  noiseBomb: 1.0,
  magnet: 0.85,
  featherFoot: 1.05,
  scentMask: 0.95,
  timeSlip: 0.4,
};

export const POWER_UP_KINDS: readonly PowerUpKind[] = ITEMS.map((item) => item.kind);
