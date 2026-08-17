import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s06-chain-link",
  "chapter": 3,
  "index": 6,
  "name": "Chain Link",
  "theme": "alley",
  "kind": "story",
  "seed": 3058682097,
  "width": 17,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#.........#...#.#",
    "#.........#.....#",
    "#.#.g....X#...#.#",
    "#.#..G#...#...#.#",
    "#.#...#.g.##..#.#",
    "#.#...#.#.....#.#",
    "#.#p..###.###.#.#",
    "#..............o#",
    "#################",
    "#################"
  ],
  "decor": [
    "     +           ",
    " +   .`,=*+   .` ",
    " `,=*+   . ,=*   ",
    "    .`,=*++  .`, ",
    " , *+   .  =*+   ",
    "   .`, *+   .` = ",
    " = +   .`,  +    ",
    "   `,=+++  .`, * ",
    " *       =     . ",
    " .`,=*+   .`,=*+ ",
    " +  +      +     ",
    "               + "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 9,
      "id": "ch03-s06-chain-link-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 3,
      "y": 3,
      "breed": "siamese",
      "patrol": 1,
      "facing": 4.36
    },
    {
      "type": "powerUp",
      "x": 6,
      "y": 4,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 2,
      "kind": "fan"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 9,
      "radius": 5.2,
      "intensity": 0.85,
      "flicker": 0.14,
      "on": true
    },
    {
      "x": 9,
      "y": 7,
      "radius": 5.4,
      "intensity": 0.71,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 9,
      "radius": 2.2,
      "intensity": 0.75,
      "color": "#d4f0a0",
      "on": true
    }
  ],
  "patrols": [
    {
      "id": 1,
      "loop": true,
      "pauseSeconds": 0.83,
      "points": [
        {
          "x": 3,
          "y": 3
        },
        {
          "x": 14,
          "y": 9
        },
        {
          "x": 6,
          "y": 4
        },
        {
          "x": 4,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Chain Link. The fire escape keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the fire escape. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the fire escape. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Chain Link banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The fire escape keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the fire escape considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 8
      },
      {
        "x": 1,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 7
      },
      {
        "x": 4,
        "y": 3
      },
      {
        "x": 13,
        "y": 5
      },
      {
        "x": 13,
        "y": 9
      }
    ],
    "aggression": 0.62,
    "scentBias": 0.63,
    "hearingBias": 0.53,
    "campHoleChance": 0.1,
    "leashRadius": 9
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 5,
      "optional": false,
      "label": "Bank 5 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 5,
  "parTime": 122,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 3.1,
  "music": "alley-neon",
  "tags": [
    "alley",
    "maze",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
