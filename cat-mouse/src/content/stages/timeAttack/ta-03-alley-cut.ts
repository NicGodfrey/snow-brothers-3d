import type { StageDef } from '../../schema';

const tiles = [
  '##################',
  '#G..............G#',
  '#....XXX.........#',
  '#.o..............#',
  '#....XXX....p....#',
  '#................#',
  '#~~~~........~~~~#',
  '#................#',
  '#..s.........X...#',
  '##################',
];

const decor = [
  '                  ',
  ' =              = ',
  '    +++           ',
  ' o                ',
  '    +++     |     ',
  '                  ',
  '~~~~        ~~~~  ',
  '                  ',
  '  ~         +     ',
  '                  ',
];

const stage: StageDef = {
  id: 'ta-03-alley-cut',
  chapter: 0,
  index: 3,
  name: 'Alley Cut',
  theme: 'alley',
  kind: 'timeAttack',
  seed: 90103,
  width: 18,
  height: 10,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 2, y: 8 },
  entities: [
    { type: 'hole', x: 2, y: 3, id: 'cut-hole' },
    { type: 'cheese', x: 8, y: 2, value: 1 },
    { type: 'cheese', x: 15, y: 1, value: 1 },
    { type: 'cheese', x: 12, y: 4, value: 1 },
    { type: 'cheese', x: 15, y: 8, value: 1 },
    { type: 'cat', x: 15, y: 5, breed: 'siamese', patrol: 1, facing: Math.PI },
    { type: 'powerUp', x: 1, y: 1, kind: 'speed' },
  ],
  lights: [
    { x: 1, y: 1, radius: 3.8, intensity: 0.8, color: '#ff4fd8', on: true, flicker: 0.3 },
    { x: 16, y: 1, radius: 3.8, intensity: 0.8, color: '#5ce1ff', on: true, flicker: 0.25 },
    { x: 2, y: 3, radius: 2.0, intensity: 0.75, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.15,
      points: [
        { x: 15, y: 5 },
        { x: 15, y: 1 },
        { x: 15, y: 8 },
        { x: 8, y: 5 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Cut the alley. Do not swim the puddles. Siamese hears a stamp from here.' },
    { at: 'firstSpotted', speaker: 'Pounce', line: 'Predictable. Seasoned with panic.' },
    { at: 'win', speaker: 'Squeak', line: 'Cut made. Neon can keep the rest of the night.' },
    { at: 'lose', speaker: 'Pounce', line: 'Schedule cancelled.' },
    { at: 'idle', speaker: 'Narrator', line: 'A can rolls like a second clock.', delay: 4 },
  ],
  hints: {
    ambushSpots: [{ x: 8, y: 3 }, { x: 15, y: 3 }],
    searchSpots: [{ x: 8, y: 2 }, { x: 15, y: 1 }, { x: 15, y: 8 }],
    aggression: 0.85,
    scentBias: 0.35,
    hearingBias: 0.9,
    campHoleChance: 0.04,
    leashRadius: 9,
  },
  objectives: [
    { kind: 'quota', value: 3, optional: false, label: 'Bank 3' },
    { kind: 'timeLimit', value: 42, optional: false, label: 'Beat 42s' },
  ],
  quota: 3,
  parTime: 42,
  lives: 2,
  ambient: 0.34,
  difficulty: 4,
  music: 'alley-neon',
  tags: ['timeAttack', 'alley', 'cut', 'solo-cat'],
};

export default stage;
