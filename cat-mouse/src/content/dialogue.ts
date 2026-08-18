import type { DialogueTree } from './schema';

export const DIALOGUE_TREES: readonly DialogueTree[] = [
  {
    id: 'intro-squeak',
    root: 'dark',
    nodes: [
      {
        id: 'dark',
        speaker: 'Narrator',
        line: 'The kitchen ticks. Somewhere a fridge compressor decides to be a monster and then thinks better of it.',
        next: 'squeak-wakes',
      },
      {
        id: 'squeak-wakes',
        speaker: 'Squeak',
        line: 'Hole to fridge is eight boards if you skip the squeaky one. I did not skip it last time. We do not talk about last time.',
        choices: [
          { label: 'Begin the raid.', next: 'ready' },
          { label: 'Wait. Where is Pounce?', next: 'where-cat' },
          { label: 'Ask Gran first.', next: 'ask-gran' },
        ],
      },
      {
        id: 'ready',
        speaker: 'Squeak',
        line: 'Quota is three. Deposit in the hole. If the yellow eyes find you, the hole still counts as home. Probably.',
      },
      {
        id: 'where-cat',
        speaker: 'Pounce',
        line: 'Under the table. Pretending to be a table. It is going extremely well.',
        next: 'ready',
      },
      {
        id: 'ask-gran',
        speaker: 'Gran',
        line: 'If you can hear me you are already too loud. Crumbs first, heroics never. And wipe your feet on the way back in.',
        next: 'ready',
      },
    ],
  },
  {
    id: 'gran-rules',
    root: 'lecture',
    nodes: [
      {
        id: 'lecture',
        speaker: 'Gran',
        line: 'Rule one: the hole is a bank, not a sofa. Rule two: dash is for dying, sneak is for living.',
        next: 'rule-three',
      },
      {
        id: 'rule-three',
        speaker: 'Gran',
        line: 'Rule three: if it glows, it is either cheese, a trap, or a bad idea wearing a hat.',
        choices: [
          { label: 'What about cats?', next: 'cats' },
          { label: 'What about crumbs?', next: 'crumbs' },
          { label: 'I have heard this.', next: 'dismiss' },
        ],
      },
      {
        id: 'cats',
        speaker: 'Gran',
        line: 'They are not puzzles. They are weather. You do not solve weather. You pack a coat and you do not stand in the open.',
        next: 'dismiss',
      },
      {
        id: 'crumbs',
        speaker: 'Gran',
        line: 'A crumb is a letter you mail to a cat. Write short letters. Mail them far from the hole.',
        next: 'dismiss',
      },
      {
        id: 'dismiss',
        speaker: 'Squeak',
        line: 'Coat packed. Letters unwritten. Fridge humming like it knows.',
      },
    ],
  },
  {
    id: 'pounce-first-meeting',
    root: 'yawn',
    nodes: [
      {
        id: 'yawn',
        speaker: 'Pounce',
        line: 'Oh good. The snack learned verbs.',
        next: 'squeak-reply',
      },
      {
        id: 'squeak-reply',
        speaker: 'Squeak',
        line: 'The snack also learned dash, sneak, and the exact width of your shoulders.',
        choices: [
          { label: 'Taunt.', next: 'taunt' },
          { label: 'Bargain.', next: 'bargain' },
          { label: 'Leave a crumb and run.', next: 'crumb' },
        ],
      },
      {
        id: 'taunt',
        speaker: 'Pounce',
        line: 'Cute. I will put that on your tiny tombstone. "Knew my shoulder width."',
      },
      {
        id: 'bargain',
        speaker: 'Pounce',
        line: 'You may keep the hole. I will keep the rest of the building, the night, and the concept of surprise.',
      },
      {
        id: 'crumb',
        speaker: 'Pounce',
        line: 'I do not eat mail. I eat the mailman. That is you.',
      },
    ],
  },
  {
    id: 'radio-tutorial',
    root: 'static',
    nodes: [
      {
        id: 'static',
        speaker: 'Radio',
        line: '—this is the pantry frequency. If you can hear the fridge you are close. If you can hear purring you are late.',
        next: 'tip',
      },
      {
        id: 'tip',
        speaker: 'Radio',
        line: 'Shift keeps your scent small. Space spends it all at once. E is how cheese becomes a future.',
        choices: [
          { label: 'Repeat the hole rule.', next: 'hole' },
          { label: 'Repeat the catch rule.', next: 'catch' },
          { label: 'Mute and go.', next: 'mute' },
        ],
      },
      {
        id: 'hole',
        speaker: 'Radio',
        line: 'Quota lives in the hole. Carrying cheese is a rumour. Banking cheese is a fact.',
      },
      {
        id: 'catch',
        speaker: 'Radio',
        line: 'Three lives. A catch is overlap without invulnerability. Respawn is the last hole that liked you.',
      },
      {
        id: 'mute',
        speaker: 'Squeak',
        line: 'Radio off. Ears on. The board third from the sink still lies about being quiet.',
      },
    ],
  },
  {
    id: 'cellar-descent',
    root: 'steps',
    nodes: [
      {
        id: 'steps',
        speaker: 'Narrator',
        line: 'The stairs to the cellar count themselves. One of them is a liar and always has been.',
        next: 'gran',
      },
      {
        id: 'gran',
        speaker: 'Gran',
        line: 'Wine is not cheese. Jars are not cheese. The thing behind the furnace is especially not cheese.',
        choices: [
          { label: 'Ask about the furnace.', next: 'furnace' },
          { label: 'Ask about the sump.', next: 'sump' },
        ],
      },
      {
        id: 'furnace',
        speaker: 'Radio',
        line: 'Heat makes scent lazy. Stay low along the coal wall and the Persian will nap through your entire personality.',
      },
      {
        id: 'sump',
        speaker: 'Squeak',
        line: 'If it ripples it is water. If it ripples and purrs it is a cat who found a grate. I vote for neither.',
      },
    ],
  },
  {
    id: 'alley-strays',
    root: 'drip',
    nodes: [
      {
        id: 'drip',
        speaker: 'Narrator',
        line: 'Neon writes your name on a puddle and then misspells it. The dumpsters already know the correct spelling.',
        next: 'stray',
      },
      {
        id: 'stray',
        speaker: 'Pounce',
        line: 'This is not your kitchen. The locals do not nap. The locals collect mice like bottle caps.',
        choices: [
          { label: 'Cut through the fire escape.', next: 'escape' },
          { label: 'Hug the wet bricks.', next: 'bricks' },
        ],
      },
      {
        id: 'escape',
        speaker: 'Squeak',
        line: 'Metal stairs sing. I will take the song over the Bombay on the loading dock.',
      },
      {
        id: 'bricks',
        speaker: 'Radio',
        line: 'Puddles keep scent like gossip. If you must cross, dash, and do not look at your own reflection. It looks catchable.',
      },
    ],
  },
  {
    id: 'sewer-echo',
    root: 'drip2',
    nodes: [
      {
        id: 'drip2',
        speaker: 'Narrator',
        line: 'Every footstep arrives twice. The second one belongs to whoever is hunting the first.',
        next: 'squeak',
      },
      {
        id: 'squeak',
        speaker: 'Squeak',
        line: 'Pipes are hallways that forgot to ask permission. Grates are holes with opinions.',
        choices: [
          { label: 'Follow the flow.', next: 'flow' },
          { label: 'Climb the maintenance walk.', next: 'walk' },
        ],
      },
      {
        id: 'flow',
        speaker: 'Gran',
        line: 'If you swallow sewer water I will not be impressed. Cheese that fell in is not a prize, it is a eulogy.',
      },
      {
        id: 'walk',
        speaker: 'Radio',
        line: 'Cats hate grate. You do not. That is the entire military doctrine of this chapter.',
      },
    ],
  },
  {
    id: 'carnival-barker',
    root: 'closed',
    nodes: [
      {
        id: 'closed',
        speaker: 'Narrator',
        line: 'The carnival is closed, which is when it is honest. The lights still sell tickets to nobody.',
        next: 'barker',
      },
      {
        id: 'barker',
        speaker: 'Radio',
        line: 'Step right up. Prize cheese behind the ring toss. Side effect: a Bengal who thinks the bumper floor is a hunting ground.',
        choices: [
          { label: 'Try the mirrors.', next: 'mirrors' },
          { label: 'Try the prize tent.', next: 'tent' },
        ],
      },
      {
        id: 'mirrors',
        speaker: 'Squeak',
        line: 'There are seven of me and one of them. Unfortunately they can smell which one pays rent.',
      },
      {
        id: 'tent',
        speaker: 'Pounce',
        line: 'I won you a stuffed mouse once. It was practice.',
      },
    ],
  },
  {
    id: 'museum-guard',
    root: 'velvet',
    nodes: [
      {
        id: 'velvet',
        speaker: 'Narrator',
        line: 'Marble remembers every nail click. The portraits have not blinked in a century and are not starting tonight.',
        next: 'guard',
      },
      {
        id: 'guard',
        speaker: 'Pounce',
        line: 'Do not touch the vases. Touching the vases makes the Maine Coon invent new physics.',
        choices: [
          { label: 'Stick to the rugs.', next: 'rugs' },
          { label: 'Cut through fossils.', next: 'fossils' },
        ],
      },
      {
        id: 'rugs',
        speaker: 'Gran',
        line: 'Rugs are sneak made of wool. Also they are where the Fold sits, looking like a hat.',
      },
      {
        id: 'fossils',
        speaker: 'Squeak',
        line: 'If a bone is bigger than me I will not debate ownership. I will be under it, counting quota.',
      },
    ],
  },
  {
    id: 'docks-fog',
    root: 'horn',
    nodes: [
      {
        id: 'horn',
        speaker: 'Narrator',
        line: 'The foghorn does not warn ships. It warns mice that the pier has opinions about gravity.',
        next: 'dock',
      },
      {
        id: 'dock',
        speaker: 'Radio',
        line: 'Planks, nets, cold storage. Cheese in the warehouse is marked "bait" which is rude but accurate.',
        choices: [
          { label: 'Take the gangway.', next: 'gangway' },
          { label: 'Swim? No.', next: 'water' },
        ],
      },
      {
        id: 'gangway',
        speaker: 'Squeak',
        line: 'A board that flexes is a board that talks. I will take the talking over the Norwegian Forest on the nets.',
      },
      {
        id: 'water',
        speaker: 'Gran',
        line: 'You are a mouse, not a rumour of a boat. If it is wet and wide, it is a wall that hates you.',
      },
    ],
  },
  {
    id: 'clocktower-chime',
    root: 'tick',
    nodes: [
      {
        id: 'tick',
        speaker: 'Narrator',
        line: 'The tower counts a thirteenth hour because it is tired of twelve being in charge.',
        next: 'chime',
      },
      {
        id: 'chime',
        speaker: 'Radio',
        line: 'When the bell speaks, every cat forgets its patrol and looks up. That is a window. It is also how you go deaf.',
        choices: [
          { label: 'Ride the pendulum gap.', next: 'pendulum' },
          { label: 'Take the winding stair.', next: 'stair' },
        ],
      },
      {
        id: 'pendulum',
        speaker: 'Squeak',
        line: 'A moving wall is still a wall. I will be the mouse-shaped hole in its schedule.',
      },
      {
        id: 'stair',
        speaker: 'Pounce',
        line: 'Stairs are a funnel with extra steps. I have been waiting at the top since Tuesday.',
      },
    ],
  },
  {
    id: 'moonlab-protocol',
    root: 'hiss',
    nodes: [
      {
        id: 'hiss',
        speaker: 'Narrator',
        line: 'Airlocks do not care about quota. They care about pressure, which is a kind of cat.',
        next: 'protocol',
      },
      {
        id: 'protocol',
        speaker: 'Radio',
        line: 'Chase Protocol revision twelve. Subject: Squeak. Hunter: classified. Objective: do not become a sample.',
        choices: [
          { label: 'Enter clean room.', next: 'clean' },
          { label: 'Avoid the centrifuge.', next: 'spin' },
        ],
      },
      {
        id: 'clean',
        speaker: 'Gran',
        line: 'If it is too white, you are the dirt. Move like a rumour and do not sneeze on the glass.',
      },
      {
        id: 'spin',
        speaker: 'Squeak',
        line: 'I have seen what the centrifuge does to cheese. I would like to remain un-spread.',
      },
    ],
  },
  {
    id: 'victory-feast',
    root: 'banked',
    nodes: [
      {
        id: 'banked',
        speaker: 'Narrator',
        line: 'The hole accepts the last wedge like a secret it was paid to keep.',
        next: 'squeak',
      },
      {
        id: 'squeak',
        speaker: 'Squeak',
        line: 'Quota. Lives leftover. Whiskers still attached. I am calling that a festival.',
        choices: [
          { label: 'Gloat.', next: 'gloat' },
          { label: 'Share with Gran.', next: 'share' },
        ],
      },
      {
        id: 'gloat',
        speaker: 'Pounce',
        line: 'Enjoy the festival. I will be in the doorway, inventing next time.',
      },
      {
        id: 'share',
        speaker: 'Gran',
        line: 'One nibble for the house, one for the hole, one for the mouse who remembered sneak. Sit down before you faint stylishly.',
      },
    ],
  },
  {
    id: 'defeat-lecture',
    root: 'caught',
    nodes: [
      {
        id: 'caught',
        speaker: 'Narrator',
        line: 'The world becomes mouth, then dark, then the inside of the hole with fewer lives.',
        next: 'pounce',
      },
      {
        id: 'pounce',
        speaker: 'Pounce',
        line: 'You taste like adrenaline and poor decisions. Come back, I am still hungry.',
        choices: [
          { label: 'Listen to Gran.', next: 'gran' },
          { label: 'Ignore advice.', next: 'ignore' },
        ],
      },
      {
        id: 'gran',
        speaker: 'Gran',
        line: 'You dashed in a sight cone. That is not bravery, that is postage. Sneak next time, or I will sneak for you and it will be embarrassing.',
      },
      {
        id: 'ignore',
        speaker: 'Squeak',
        line: 'Fine. New plan. Same hole. Slightly more respect for yellow eyes.',
      },
    ],
  },
  {
    id: 'arcade-announcer',
    root: 'heat',
    nodes: [
      {
        id: 'heat',
        speaker: 'Radio',
        line: 'Arcade heat is a kettle. It does not boil politely. Cats arrive in breeds you have not studied.',
        next: 'wave',
      },
      {
        id: 'wave',
        speaker: 'Narrator',
        line: 'A bell that never belonged to a church rings anyway. The floor grows another hunter.',
        choices: [
          { label: 'Ask for the rule.', next: 'rule' },
          { label: 'Just run.', next: 'run' },
        ],
      },
      {
        id: 'rule',
        speaker: 'Squeak',
        line: 'Bank until the director gets bored or I run out of futures. There is no chapter map. There is only more cat.',
      },
      {
        id: 'run',
        speaker: 'Pounce',
        line: 'I brought friends. They brought hunger. You brought a thimble. This is going to be educational.',
      },
    ],
  },
  {
    id: 'timeattack-clock',
    root: 'par',
    nodes: [
      {
        id: 'par',
        speaker: 'Radio',
        line: 'Par is not a suggestion. Par is a dare written by a clock that has never been a mouse.',
        next: 'go',
      },
      {
        id: 'go',
        speaker: 'Squeak',
        line: 'No sightseeing. No grooming. Cheese, hole, cheese, hole, do not become an anecdote.',
        choices: [
          { label: 'Take the risky line.', next: 'risky' },
          { label: 'Take the quiet line.', next: 'quiet' },
        ],
      },
      {
        id: 'risky',
        speaker: 'Pounce',
        line: 'I love a mouse on a schedule. Predictable. Seasoned with panic.',
      },
      {
        id: 'quiet',
        speaker: 'Gran',
        line: 'Quiet is slower until it is not. A catch costs more seconds than sneak ever did.',
      },
    ],
  },
];

export const DIALOGUE_BY_ID: Readonly<Record<string, DialogueTree>> = Object.fromEntries(
  DIALOGUE_TREES.map((tree) => [tree.id, tree]),
);

export const DIALOGUE_TREE_IDS: readonly string[] = DIALOGUE_TREES.map((tree) => tree.id);

export function dialogueNode(tree: DialogueTree, id: string) {
  return tree.nodes.find((node) => node.id === id);
}
