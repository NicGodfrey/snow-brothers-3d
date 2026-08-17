import type { StageDef } from '../../schema';

const tiles = [
  '################',
  '#..............#',
  '#..T....T......#',
  '#..............#',
  '#.o....X.......#',
  '#..............#',
  '#......T....T..#',
  '#..............#',
  '#...........g..#',
  '################',
];

const decor = [
  '                ',
  ' .    .    .    ',
  '  =    =        ',
  '                ',
  ' o    +         ',
  '                ',
  '      =    =    ',
  '                ',
  '           `    ',
  '                ',
];

const stage: StageDef = {
  id: 'ta-01-sprint-pantry',
  chapter: 0,
  index: 1,
  name: 'Sprint Pantry',
  theme: 'kitchen',
  kind: 'timeAttack',
  seed: 90101,
  width: 16,
  height: 10,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 2, y: 8 },
  entities: [
    { type: 'hole', x: 2, y: 4, id: 'sprint-hole' },
    { type: 'cheese', x: 6, y: 2, value: 1 },
    { type: 'cheese', x: 12, y: 3, value: 1 },
    { type: 'cheese', x: 9, y: 6, value: 1 },
    { type: 'cheese', x: 13, y: 8, value: 1 },
    { type: 'cat', x: 13, y: 4, breed: 'manx', patrol: 1, facing: Math.PI },
    { type: 'powerUp', x: 14, y: 8, kind: 'speed' },
  ],
  lights: [
    { x: 4, y: 2, radius: 3.5, intensity: 0.7, color: '#fff1c8', on: true },
    { x: 2, y: 4, radius: 2.0, intensity: 0.8, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.2,
      points: [
        { x: 13, y: 4 },
        { x: 13, y: 1 },
        { x: 13, y: 8 },
        { x: 8, y: 4 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Par is a dare. Cheese, hole, cheese, hole. Do not become an anecdote.' },
    { at: 'firstCheese', speaker: 'Squeak', line: 'No sightseeing.' },
    { at: 'firstSpotted', speaker: 'Pounce', line: 'I love a mouse on a schedule.' },
    { at: 'win', speaker: 'Squeak', line: 'Under par. The pantry can keep its opinions.' },
    { at: 'lose', speaker: 'Gran', line: 'A catch costs more seconds than sneak ever did.' },
    { at: 'idle', speaker: 'Narrator', line: 'The clock is a cat with numbers.', delay: 4 },
  ],
  hints: {
    ambushSpots: [{ x: 8, y: 4 }, { x: 3, y: 4 }],
    searchSpots: [{ x: 6, y: 2 }, { x: 12, y: 3 }, { x: 13, y: 8 }],
    aggression: 0.7,
    scentBias: 0.3,
    hearingBias: 0.5,
    campHoleChance: 0.02,
    leashRadius: 8,
  },
  objectives: [
    { kind: 'quota', value: 3, optional: false, label: 'Bank 3' },
    { kind: 'timeLimit', value: 45, optional: false, label: 'Beat 45s' },
  ],
  quota: 3,
  parTime: 45,
  lives: 2,
  ambient: 0.62,
  difficulty: 3,
  music: 'kitchen-night',
  tags: ['timeAttack', 'kitchen', 'sprint', 'solo-cat'],
};

export default stage;
