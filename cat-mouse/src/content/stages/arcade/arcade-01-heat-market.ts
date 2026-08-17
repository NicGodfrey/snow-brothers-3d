import type { StageDef } from '../../schema';

const tiles = [
  '##################',
  '#................#',
  '#..X..X..X..X....#',
  '#................#',
  '#.o....~~~~......#',
  '#......~~~~......#',
  '#..X..X..X..X....#',
  '#................#',
  '#.............g..#',
  '#................#',
  '##################',
];

const decor = [
  '                  ',
  ' .  .  .  .  .    ',
  '  +  +  +  +      ',
  '                  ',
  ' o    ~~~~        ',
  '      ~~~~        ',
  '  +  +  +  +      ',
  '                  ',
  '             `    ',
  '  ,        ,      ',
  '                  ',
];

const stage: StageDef = {
  id: 'arcade-01-heat-market',
  chapter: 0,
  index: 1,
  name: 'Heat Market',
  theme: 'kitchen',
  kind: 'arcade',
  seed: 80101,
  width: 18,
  height: 11,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 2, y: 9 },
  entities: [
    { type: 'hole', x: 2, y: 4, id: 'market-hole' },
    { type: 'cheese', x: 5, y: 1, value: 1 },
    { type: 'cheese', x: 8, y: 3, value: 1 },
    { type: 'cheese', x: 14, y: 2, value: 1 },
    { type: 'cheese', x: 11, y: 7, value: 1 },
    { type: 'cheese', x: 15, y: 9, value: 1 },
    { type: 'cat', x: 15, y: 4, breed: 'siamese', patrol: 1, facing: Math.PI },
    { type: 'powerUp', x: 16, y: 8, kind: 'speed' },
    { type: 'hazard', x: 8, y: 5, kind: 'broom' },
  ],
  lights: [
    { x: 4, y: 2, radius: 3.5, intensity: 0.7, color: '#fff1c8', on: true },
    { x: 14, y: 6, radius: 3.5, intensity: 0.55, color: '#ffb060', on: true, flicker: 0.15 },
    { x: 2, y: 4, radius: 2.2, intensity: 0.8, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.35,
      points: [
        { x: 15, y: 4 },
        { x: 15, y: 1 },
        { x: 15, y: 9 },
        { x: 8, y: 8 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Arcade heat is a kettle. Bank until the director gets bored or you run out of futures.' },
    { at: 'firstCheese', speaker: 'Squeak', line: 'Market cheddar. It does not wait.' },
    { at: 'firstSpotted', speaker: 'Pounce', line: 'I brought friends later. For now, just speed.' },
    { at: 'halfQuota', speaker: 'Narrator', line: 'The kettle notices you.' },
    { at: 'win', speaker: 'Squeak', line: 'Wave banked. The kettle is still a kettle.' },
    { at: 'lose', speaker: 'Pounce', line: 'Educational.' },
    { at: 'idle', speaker: 'Radio', line: 'Heat rises. So should your dash discipline.', delay: 6 },
  ],
  hints: {
    ambushSpots: [
      { x: 8, y: 4 },
      { x: 3, y: 4 },
    ],
    searchSpots: [
      { x: 5, y: 1 },
      { x: 14, y: 2 },
      { x: 15, y: 9 },
    ],
    aggression: 0.8,
    scentBias: 0.4,
    hearingBias: 0.7,
    campHoleChance: 0.05,
    leashRadius: 12,
  },
  objectives: [
    { kind: 'quota', value: 4, optional: false, label: 'Bank 4 before the heat' },
  ],
  quota: 4,
  parTime: 70,
  lives: 3,
  ambient: 0.62,
  difficulty: 4,
  music: 'kitchen-night',
  tags: ['arcade', 'kitchen', 'heat', 'solo-cat'],
};

export default stage;
