import type { StageDef } from '../../schema';

const tiles = [
  '#################',
  '#pp...........pp#',
  '#p.............p#',
  '#p.o...........p#',
  '#p....~~~~~....p#',
  '#p....~~~~~....p#',
  '#p.............p#',
  '#p..g.......g..p#',
  '#pp...........pp#',
  '#################',
];

const decor = [
  '                 ',
  '||           ||  ',
  '|             |  ',
  '| o           |  ',
  '|    ~~~~~    |  ',
  '|    ~~~~~    |  ',
  '|             |  ',
  '|  `       `  |  ',
  '||           ||  ',
  '                 ',
];

const stage: StageDef = {
  id: 'ta-04-pipe-shot',
  chapter: 0,
  index: 4,
  name: 'Pipe Shot',
  theme: 'sewer',
  kind: 'timeAttack',
  seed: 90104,
  width: 17,
  height: 10,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 8, y: 8 },
  entities: [
    { type: 'hole', x: 3, y: 3, id: 'shot-hole' },
    { type: 'cheese', x: 8, y: 2, value: 1 },
    { type: 'cheese', x: 13, y: 3, value: 1 },
    { type: 'cheese', x: 5, y: 7, value: 1 },
    { type: 'cheese', x: 12, y: 7, value: 1 },
    { type: 'cat', x: 8, y: 1, breed: 'sphynx', patrol: 1, facing: Math.PI / 2 },
    { type: 'powerUp', x: 14, y: 5, kind: 'featherFoot' },
  ],
  lights: [
    { x: 4, y: 3, radius: 2.8, intensity: 0.45, color: '#c6e36a', on: true },
    { x: 12, y: 5, radius: 2.8, intensity: 0.4, color: '#9ad14a', on: true, flicker: 0.15 },
    { x: 3, y: 3, radius: 2.0, intensity: 0.75, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.2,
      points: [
        { x: 8, y: 1 },
        { x: 14, y: 3 },
        { x: 8, y: 8 },
        { x: 3, y: 6 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Pipe shot. Water is a wall. Grates are the only honest doors. Beat par or become a drip.' },
    { at: 'firstCheese', speaker: 'Squeak', line: 'Shot taken.' },
    { at: 'win', speaker: 'Squeak', line: 'The pipe can keep its echo.' },
    { at: 'lose', speaker: 'Pounce', line: 'Ledger, meet clock.' },
    { at: 'idle', speaker: 'Narrator', line: 'A drip is already winning.', delay: 4 },
  ],
  hints: {
    ambushSpots: [{ x: 8, y: 3 }, { x: 4, y: 3 }],
    searchSpots: [{ x: 8, y: 2 }, { x: 13, y: 3 }, { x: 12, y: 7 }],
    aggression: 0.75,
    scentBias: 0.9,
    hearingBias: 0.4,
    campHoleChance: 0.08,
    leashRadius: 8,
  },
  objectives: [
    { kind: 'quota', value: 3, optional: false, label: 'Bank 3' },
    { kind: 'timeLimit', value: 48, optional: false, label: 'Beat 48s' },
  ],
  quota: 3,
  parTime: 48,
  lives: 2,
  ambient: 0.3,
  difficulty: 4,
  music: 'sewer-flow',
  tags: ['timeAttack', 'sewer', 'pipe', 'solo-cat'],
};

export default stage;
