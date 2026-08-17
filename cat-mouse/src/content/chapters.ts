import type { ChapterDef, ThemeId } from './schema';

export const STORY_STAGE_IDS: readonly (readonly string[])[] = [
  [
    'ch01-s01-crumb-trail',
    'ch01-s02-breadbox-heist',
    'ch01-s03-midnight-fridge',
    'ch01-s04-sink-island',
    'ch01-s05-spice-rack',
    'ch01-s06-oven-warmth',
    'ch01-s07-dishwasher-hum',
    'ch01-s08-gran-returns',
  ],
  [
    'ch02-s01-wine-rows',
    'ch02-s02-coal-chute',
    'ch02-s03-root-cellar',
    'ch02-s04-furnace-glow',
    'ch02-s05-jar-shelf',
    'ch02-s06-flooded-sump',
    'ch02-s07-rafter-run',
    'ch02-s08-locked-hatch',
  ],
  [
    'ch03-s01-dumpster-row',
    'ch03-s02-fire-escape',
    'ch03-s03-wet-bricks',
    'ch03-s04-neon-puddle',
    'ch03-s05-loading-dock',
    'ch03-s06-chain-link',
    'ch03-s07-stray-circle',
    'ch03-s08-rooftop-leap',
  ],
  [
    'ch04-s01-pipe-crawl',
    'ch04-s02-grate-gallery',
    'ch04-s03-overflow-gate',
    'ch04-s04-echo-tunnel',
    'ch04-s05-maintenance-walk',
    'ch04-s06-sludge-bend',
    'ch04-s07-pump-room',
    'ch04-s08-outflow-door',
  ],
  [
    'ch05-s01-trunk-maze',
    'ch05-s02-insulation-sea',
    'ch05-s03-dormer-window',
    'ch05-s04-hatbox-stack',
    'ch05-s05-chimney-nook',
    'ch05-s06-loose-board',
    'ch05-s07-owl-rafter',
    'ch05-s08-widow-walk',
  ],
  [
    'ch06-s01-ticket-booth',
    'ch06-s02-bumper-floor',
    'ch06-s03-cotton-stall',
    'ch06-s04-hall-of-mirrors',
    'ch06-s05-ferris-shadow',
    'ch06-s06-ring-toss',
    'ch06-s07-funhouse-tilt',
    'ch06-s08-prize-tent',
  ],
  [
    'ch07-s01-marble-foyer',
    'ch07-s02-armor-hall',
    'ch07-s03-vase-wing',
    'ch07-s04-night-watch',
    'ch07-s05-fossil-pit',
    'ch07-s06-portrait-gaze',
    'ch07-s07-skydome',
    'ch07-s08-archive-vault',
  ],
  [
    'ch08-s01-platform-edge',
    'ch08-s02-turnstile-jam',
    'ch08-s03-bench-row',
    'ch08-s04-third-rail',
    'ch08-s05-service-tunnel',
    'ch08-s06-map-kiosk',
    'ch08-s07-lost-and-found',
    'ch08-s08-ghost-express',
  ],
  [
    'ch09-s01-pier-planks',
    'ch09-s02-crate-city',
    'ch09-s03-net-loft',
    'ch09-s04-foghorn-bay',
    'ch09-s05-warehouse-aisle',
    'ch09-s06-gangway',
    'ch09-s07-cold-storage',
    'ch09-s08-captain-cabin',
  ],
  [
    'ch10-s01-seedling-rows',
    'ch10-s02-mist-house',
    'ch10-s03-potting-bench',
    'ch10-s04-orchid-maze',
    'ch10-s05-irrigation',
    'ch10-s06-compost-heap',
    'ch10-s07-glass-ridge',
    'ch10-s08-queen-agave',
  ],
  [
    'ch11-s01-gear-floor',
    'ch11-s02-pendulum-well',
    'ch11-s03-bell-loft',
    'ch11-s04-escapement',
    'ch11-s05-winding-stair',
    'ch11-s06-counterweight',
    'ch11-s07-face-scaffold',
    'ch11-s08-midnight-chime',
  ],
  [
    'ch12-s01-airlock',
    'ch12-s02-sample-vault',
    'ch12-s03-centrifuge',
    'ch12-s04-clean-room',
    'ch12-s05-observation',
    'ch12-s06-reactor-catwalk',
    'ch12-s07-cryo-bay',
    'ch12-s08-launch-cradle',
  ],
];

export const ARCADE_STAGE_IDS: readonly string[] = [
  'arcade-01-heat-market',
  'arcade-02-neon-chase',
  'arcade-03-pipe-panic',
  'arcade-04-crowd-surge',
  'arcade-05-mirror-bowl',
  'arcade-06-grate-storm',
  'arcade-07-dock-rush',
  'arcade-08-bloom-break',
  'arcade-09-bell-sprint',
  'arcade-10-lab-leak',
  'arcade-11-crumb-riot',
  'arcade-12-alley-overflow',
  'arcade-13-attic-draft',
  'arcade-14-carnival-spin',
  'arcade-15-marble-heat',
  'arcade-16-third-rail-jam',
  'arcade-17-fog-pileup',
  'arcade-18-orchid-burst',
  'arcade-19-gear-flood',
  'arcade-20-airlock-wave',
  'arcade-21-double-pounce',
  'arcade-22-quota-fever',
  'arcade-23-director-max',
  'arcade-24-last-kettle',
];

export const TIME_ATTACK_STAGE_IDS: readonly string[] = [
  'ta-01-sprint-pantry',
  'ta-02-cellar-dash',
  'ta-03-alley-cut',
  'ta-04-pipe-shot',
  'ta-05-rafter-line',
  'ta-06-bumper-split',
  'ta-07-foyer-blitz',
  'ta-08-platform-fly',
  'ta-09-pier-run',
  'ta-10-glass-cut',
  'ta-11-pendulum-gap',
  'ta-12-protocol-go',
];

const CHAPTER_TITLES: readonly { title: string; theme: ThemeId; blurb: string }[] = [
  {
    title: 'The Pantry Raid',
    theme: 'kitchen',
    blurb: 'Gran\'s kitchen after lights-out. Three wedges, one tabby, and a hole that has heard every excuse.',
  },
  {
    title: 'Below the Floorboards',
    theme: 'cellar',
    blurb: 'Bottles, coal, and a furnace that keeps secrets warm. The Persian considers the hatch a throne.',
  },
  {
    title: 'Night Shift',
    theme: 'alley',
    blurb: 'Dumpsters, neon, and strays who do not nap. The wet bricks remember every dash.',
  },
  {
    title: 'Down the Drain',
    theme: 'sewer',
    blurb: 'Overflow tunnels where footsteps arrive twice. Grates are the only honest doors.',
  },
  {
    title: 'Dust and Moonlight',
    theme: 'attic',
    blurb: 'Trunks, hatboxes, and a dormer that frames the moon like bait. The rafters creak on purpose.',
  },
  {
    title: 'After Hours',
    theme: 'carnival',
    blurb: 'A closed carnival is a honest one. Prize cheese sits behind games that still want a winner.',
  },
  {
    title: 'After Closing',
    theme: 'museum',
    blurb: 'Marble, velvet, and a night watch that never clocks out. Do not argue with the vases.',
  },
  {
    title: 'Last Train',
    theme: 'subway',
    blurb: 'Sodium light, turnstiles, and a platform edge that hums. The ghost express is only mostly a metaphor.',
  },
  {
    title: 'Tide Shift',
    theme: 'docks',
    blurb: 'Piers, nets, and cold storage marked bait. Fog makes sight optional and hearing mandatory.',
  },
  {
    title: 'Night Bloom',
    theme: 'greenhouse',
    blurb: 'Rows, mist, and a queen agave that has outlived three gardeners and one cat.',
  },
  {
    title: 'Thirteen O\'Clock',
    theme: 'clocktower',
    blurb: 'Gears, bells, and a pendulum that is a moving wall. The thirteenth hour is a window.',
  },
  {
    title: 'Chase Protocol',
    theme: 'moonLab',
    blurb: 'Airlocks, samples, and a launch cradle that was not built for mice. File yourself as an anomaly.',
  },
];

export const CHAPTERS: readonly ChapterDef[] = CHAPTER_TITLES.map((meta, index) => ({
  index: index + 1,
  title: meta.title,
  theme: meta.theme,
  blurb: meta.blurb,
  stageIds: STORY_STAGE_IDS[index] ?? [],
  unlockAfter: index,
}));

export const CHAPTER_BY_INDEX: Readonly<Record<number, ChapterDef>> = Object.fromEntries(
  CHAPTERS.map((chapter) => [chapter.index, chapter]),
);

export const ALL_STORY_STAGE_IDS: readonly string[] = STORY_STAGE_IDS.flat();

export function chapterTheme(index: number): ThemeId {
  return CHAPTERS[index - 1]?.theme ?? 'kitchen';
}

export function stageChapterOf(stageId: string): number {
  const found = ALL_STORY_STAGE_IDS.indexOf(stageId);
  if (found < 0) return 0;
  return Math.floor(found / 8) + 1;
}
