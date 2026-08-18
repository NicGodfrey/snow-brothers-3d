import type { StageDef } from '../../schema';

const tiles = [
  '####################',
  '#G................G#',
  '#......XXXX........#',
  '#......X...........#',
  '#.o....XXXX....p...#',
  '#..................#',
  '#~~~~..........~~~~#',
  '#~~~~..........~~~~#',
  '#..............s...#',
  '#..XXX....XXX......#',
  '#..................#',
  '####################',
];

const decor = [
  '                    ',
  ' =                = ',
  '      ++++          ',
  '      +             ',
  ' o    ++++    |     ',
  '                    ',
  '~~~~          ~~~~  ',
  '~~~~          ~~~~  ',
  '              ~     ',
  '  +++    +++        ',
  '  .            .    ',
  '                    ',
];

const stage: StageDef = {
  id: 'arcade-02-neon-chase',
  chapter: 0,
  index: 2,
  name: 'Neon Chase',
  theme: 'alley',
  kind: 'arcade',
  seed: 80102,
  width: 20,
  height: 12,
  tileSize: 16,
  tiles,
  decor,
  spawn: { x: 2, y: 10 },
  entities: [
    { type: 'hole', x: 2, y: 4, id: 'neon-hole' },
    { type: 'cheese', x: 8, y: 3, value: 1 },
    { type: 'cheese', x: 16, y: 2, value: 1 },
    { type: 'cheese', x: 4, y: 9, value: 1 },
    { type: 'cheese', x: 12, y: 9, value: 1 },
    { type: 'cheese', x: 17, y: 8, value: 1 },
    { type: 'cat', x: 17, y: 4, breed: 'bombay', patrol: 1, facing: Math.PI },
    { type: 'cat', x: 10, y: 10, breed: 'bengal', patrol: 2, facing: 0 },
    { type: 'powerUp', x: 1, y: 1, kind: 'invisibility' },
    { type: 'hazard', x: 2, y: 6, kind: 'water' },
  ],
  lights: [
    { x: 1, y: 1, radius: 4.0, intensity: 0.85, color: '#ff4fd8', on: true, flicker: 0.35 },
    { x: 18, y: 1, radius: 4.0, intensity: 0.85, color: '#5ce1ff', on: true, flicker: 0.3 },
    { x: 2, y: 4, radius: 2.2, intensity: 0.7, color: '#d4f0a0', on: true },
  ],
  patrols: [
    {
      id: 1,
      loop: true,
      pauseSeconds: 0.25,
      points: [
        { x: 17, y: 4 },
        { x: 17, y: 1 },
        { x: 10, y: 5 },
        { x: 17, y: 8 },
      ],
    },
    {
      id: 2,
      loop: true,
      pauseSeconds: 0.4,
      points: [
        { x: 10, y: 10 },
        { x: 3, y: 10 },
        { x: 16, y: 10 },
        { x: 10, y: 8 },
      ],
    },
  ],
  dialogue: [
    { at: 'enter', speaker: 'Radio', line: 'Neon chase. Two hunters. Puddles keep scent. Glass corners lie about being walls.' },
    { at: 'firstSpotted', speaker: 'Pounce', line: 'The locals do not nap.' },
    { at: 'halfQuota', speaker: 'Squeak', line: 'Half. The kettle is screaming in pink.' },
    { at: 'win', speaker: 'Squeak', line: 'Banked under a buzzing lie.' },
    { at: 'lose', speaker: 'Pounce', line: 'Bottle cap. Again.' },
    { at: 'idle', speaker: 'Narrator', line: 'A sign flickers CLOSED as if that ever helped.', delay: 5 },
  ],
  hints: {
    ambushSpots: [
      { x: 8, y: 4 },
      { x: 16, y: 6 },
    ],
    searchSpots: [
      { x: 8, y: 3 },
      { x: 16, y: 2 },
      { x: 12, y: 9 },
    ],
    aggression: 0.9,
    scentBias: 0.5,
    hearingBias: 0.85,
    campHoleChance: 0.04,
    leashRadius: 14,
  },
  objectives: [
    { kind: 'quota', value: 4, optional: false, label: 'Bank 4 under neon' },
  ],
  quota: 4,
  parTime: 65,
  lives: 3,
  ambient: 0.34,
  difficulty: 5.5,
  music: 'alley-neon',
  tags: ['arcade', 'alley', 'multi-cat', 'neon'],
};

export default stage;
