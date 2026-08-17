import type { StageDef } from '../../schema';

const tiles = [
  '###################',
  '#ppp...........ppp#',
  '#p...............p#',
  '#p..g.........g..p#',
  '#p...............p#',
  '#o....~~~~~~~.....#',
  '#.....~~~~~~~.....#',
  '#p...............p#',
  '#p..X.........X..p#',
  '#p...............p#',
  '#ppp...........ppp#',
  '###################',
];

const decor = [
  '                   ',
  '|||           |||  ',
  '|               |  ',
  '|  `         `  |  ',
  '|               |  ',
  'o    ~~~~~~~       ',
  '     ~~~~~~~       ',
  '|               |  ',
  '|  +         +  |  ',
  '|               |  ',
  '|||           |||  ',
  '                   ',
];

const stage: StageDef = {
  id: 'arcade-03-pipe-panic',
  chapter: 0,
  index: 3,
  name: 'Pipe Panic',
  theme: 'sewer',
  kind: 'arcade',
  seed: 80103,
  width: 19,
  height: 12,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 9, y: 9 },
  entities: [
    { type: 'hole', x: 1, y: 5, id: 'panic-hole' },
    { type: 'cheese', x: 5, y: 2, value: 1 },
    { type: 'cheese', x: 13, y: 2, value: 1 },
    { type: 'cheese', x: 9, y: 4, value: 1 },
    { type: 'cheese', x: 4, y: 8, value: 1 },
    { type: 'cheese', x: 14, y: 8, value: 1 },
    { type: 'cat', x: 9, y: 2, breed: 'sphynx', patrol: 1, facing: Math.PI / 2 },
    { type: 'powerUp', x: 17, y: 5, kind: 'scentMask' },
    { type: 'hazard', x: 9, y: 5, kind: 'water' },
    { type: 'hazard', x: 9, y: 7, kind: 'fan' },
  ],
  lights: [
    { x: 4, y: 3, radius: 3.0, intensity: 0.4, color: '#c6e36a', on: true, flicker: 0.2 },
    { x: 14, y: 3, radius: 3.0, intensity: 0.4, color: '#9ad14a', on: true, flicker: 0.18 },
    { x: 1, y: 5, radius: 2.2, intensity: 0.7, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.3,
      points: [
        { x: 9, y: 2 },
        { x: 16, y: 4 },
        { x: 9, y: 10 },
        { x: 3, y: 4 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Pipe panic. Channel water is a wall. Grates are doors. Sphynx is a ledger.' },
    { at: 'firstCheese', speaker: 'Squeak', line: 'Wet rind. Dry plan.' },
    { at: 'firstSpotted', speaker: 'Pounce', line: 'Yesterday called. It gave me your route.' },
    { at: 'win', speaker: 'Squeak', line: 'Banked in a pipe that forgot to be a hallway.' },
    { at: 'lose', speaker: 'Pounce', line: 'Ledger closed.' },
    { at: 'idle', speaker: 'Narrator', line: 'The fan throws your name west.', delay: 5 },
  ],
  hints: {
    ambushSpots: [
      { x: 9, y: 4 },
      { x: 2, y: 5 },
    ],
    searchSpots: [
      { x: 5, y: 2 },
      { x: 13, y: 2 },
      { x: 14, y: 8 },
    ],
    aggression: 0.78,
    scentBias: 1.05,
    hearingBias: 0.45,
    campHoleChance: 0.1,
    leashRadius: 11,
  },
  objectives: [
    { kind: 'quota', value: 4, optional: false, label: 'Bank 4 between pipes' },
  ],
  quota: 4,
  parTime: 72,
  lives: 3,
  ambient: 0.3,
  difficulty: 5,
  music: 'sewer-flow',
  tags: ['arcade', 'sewer', 'pipe', 'solo-cat'],
};

export default stage;
