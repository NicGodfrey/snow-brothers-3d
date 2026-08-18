import type { DialogueBeat } from './schema';
import type { ThemeId } from './schema';

export const SQUEAK_ENTER: readonly string[] = [
  'Eight boards if you skip the noisy one. I am skipping it.',
  'Quota first, gloating later, fainting never.',
  'If it glows yellow it is either cheese or a bad decision.',
  'I packed sneak. I packed dash. I did not pack dignity.',
  'The hole is a bank. I am a very small accountant.',
  'Pounce thinks I am a rumour. Rumours bank cheese.',
];

export const POUNCE_ENTER: readonly string[] = [
  'I heard a verb. Verbs are edible.',
  'The snack learned a map. How industrious. How doomed.',
  'I will be in the doorway, practising stillness.',
  'Dash if you must. I enjoy leading the shot.',
  'Your hole is a suggestion. My mouth is a fact.',
  'I brought patience and teeth. Guess which one is louder.',
];

export const GRAN_ENTER: readonly string[] = [
  'If you can hear me you are already too loud.',
  'Crumbs are letters. Mail them far from home.',
  'Wipe your feet. The hole is not a doormat for panic.',
  'Sneak is a coat. Wear it. Dash is a stamp. Spend it once.',
  'Do not eat the bait that knows your name.',
  'I did not raise you to be an anecdote.',
];

export const RADIO_ENTER: readonly string[] = [
  'Pantry frequency. Fridge close, purring late.',
  'Shift shrinks scent. Space spends it. E makes cheese a future.',
  'If the floor hums it is either a train or a vacuum. Both bite.',
  'Cats hate grate. You do not. File that under doctrine.',
  'Par is a dare. Catches cost more seconds than sneak.',
  'Heat is a kettle. It does not boil politely.',
];

export const NARRATOR_ENTER: readonly string[] = [
  'The house ticks like it is keeping a second set of books.',
  'Dust hangs in the light as if it were paid to.',
  'Somewhere a compressor chooses violence, then apology.',
  'The dark here has furniture in it.',
  'Footsteps arrive twice. The second one is not yours.',
  'A closed sign is a kind of invitation.',
];

export const WIN_LINES: readonly string[] = [
  'Quota. Whiskers attached. Call it a festival.',
  'The hole keeps secrets it was paid to keep.',
  'Pounce will invent next time. Let them.',
  'Banked. The fridge can keep its opinions.',
  'Gran will pretend she is not proud. She is proud.',
];

export const LOSE_LINES: readonly string[] = [
  'Mouth, dark, fewer lives. Same hole.',
  'You tasted like adrenaline and poor postage.',
  'Dash in a cone is not bravery.',
  'The map is still true. You are slightly less true.',
  'Come back. The hunter is still hungry.',
];

export const IDLE_LINES: readonly string[] = [
  'A board considers creaking and then does not. Suspicious.',
  'Far off, a collar tag writes a small bright letter.',
  'The cheese smells like a dare with dairy in it.',
  'You could nap. You will not nap.',
  'The hole breathes like a tiny train tunnel.',
];

export const THEME_VERBS: Readonly<Record<ThemeId, readonly string[]>> = {
  cellar: ['drip', 'cellar', 'bottle', 'coal', 'furnace'],
  kitchen: ['nibble', 'fridge', 'crumb', 'sink', 'oven'],
  alley: ['slink', 'neon', 'dumpster', 'puddle', 'dock'],
  sewer: ['echo', 'pipe', 'grate', 'overflow', 'pump'],
  attic: ['dust', 'trunk', 'rafter', 'moth', 'dormer'],
  carnival: ['spin', 'booth', 'bumper', 'mirror', 'prize'],
  museum: ['hush', 'marble', 'vase', 'armor', 'vault'],
  subway: ['hum', 'platform', 'turnstile', 'rail', 'kiosk'],
  docks: ['fog', 'pier', 'net', 'gangway', 'hold'],
  greenhouse: ['bloom', 'mist', 'row', 'orchid', 'agave'],
  clocktower: ['tick', 'gear', 'bell', 'pendulum', 'chime'],
  moonLab: ['hiss', 'airlock', 'sample', 'cryo', 'protocol'],
};

export function pickLine(lines: readonly string[], salt: number): string {
  if (lines.length === 0) return '';
  const index = Math.abs(salt) % lines.length;
  return lines[index] ?? '';
}

export function beat(
  at: DialogueBeat['at'],
  speaker: DialogueBeat['speaker'],
  line: string,
  delay = 0,
): DialogueBeat {
  return delay > 0 ? { at, speaker, line, delay } : { at, speaker, line };
}
