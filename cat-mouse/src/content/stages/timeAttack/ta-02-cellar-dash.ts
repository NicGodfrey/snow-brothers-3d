import type { StageDef } from '../../schema';

const tiles = [
  '##################',
  '#s...............#',
  '##s.....X........#',
  '###s.............#',
  '#.o.s........X...#',
  '#....s...........#',
  '#.....s~~~~......#',
  '#......s~~~......#',
  '#.......s........#',
  '#................#',
  '##################',
];

const decor = [
  '                  ',
  ' ~                ',
  '  ~     +         ',
  '   ~              ',
  ' o  ~        +    ',
  '     ~            ',
  '      ~~~~~       ',
  '       ~~~~       ',
  '        ~         ',
  '  .          .    ',
  '                  ',
];

const stage: StageDef = {
  id: 'ta-02-cellar-dash',
  chapter: 0,
  index: 2,
  name: 'Cellar Dash',
  theme: 'cellar',
  kind: 'timeAttack',
  seed: 90102,
  width: 18,
  height: 11,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 16, y: 1 },
  entities: [
    { type: 'hole', x: 2, y: 4, id: 'cellar-dash-hole' },
    { type: 'cheese', x: 10, y: 1, value: 1 },
    { type: 'cheese', x: 14, y: 3, value: 1 },
    { type: 'cheese', x: 8, y: 6, value: 1 },
    { type: 'cheese', x: 15, y: 8, value: 1 },
    { type: 'cat', x: 12, y: 8, breed: 'persian', patrol: 1, facing: -Math.PI / 2 },
    { type: 'hazard', x: 8, y: 7, kind: 'water' },
  ],
  lights: [
    { x: 4, y: 2, radius: 3.0, intensity: 0.35, color: '#e6c27a', on: true, flicker: 0.15 },
    { x: 2, y: 4, radius: 2.0, intensity: 0.75, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.8,
      points: [
        { x: 12, y: 8 },
        { x: 16, y: 8 },
        { x: 12, y: 5 },
        { x: 8, y: 9 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Down the stairs, around the sump, into the hole. Persian is a doorstop. Do not debate it.' },
    { at: 'firstCheese', speaker: 'Squeak', line: 'No cellar sightseeing.' },
    { at: 'win', speaker: 'Squeak', line: 'Par broken like a cheap bottle.' },
    { at: 'lose', speaker: 'Pounce', line: 'The pendulum of this cellar is my paw.' },
    { at: 'idle', speaker: 'Narrator', line: 'A drop counts faster than you.', delay: 4 },
  ],
  hints: {
    ambushSpots: [{ x: 5, y: 4 }, { x: 12, y: 6 }],
    searchSpots: [{ x: 10, y: 1 }, { x: 14, y: 3 }, { x: 15, y: 8 }],
    aggression: 0.35,
    scentBias: 0.7,
    hearingBias: 0.3,
    campHoleChance: 0.3,
    leashRadius: 7,
  },
  objectives: [
    { kind: 'quota', value: 3, optional: false, label: 'Bank 3' },
    { kind: 'timeLimit', value: 50, optional: false, label: 'Beat 50s' },
  ],
  quota: 3,
  parTime: 50,
  lives: 2,
  ambient: 0.28,
  difficulty: 3.5,
  music: 'cellar-drip',
  tags: ['timeAttack', 'cellar', 'stairs', 'solo-cat'],
};

export default stage;
