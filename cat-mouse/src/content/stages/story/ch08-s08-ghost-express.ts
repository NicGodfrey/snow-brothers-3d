import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s08-ghost-express",
  "chapter": 8,
  "index": 8,
  "name": "Ghost Express",
  "theme": "subway",
  "kind": "story",
  "seed": 3872355013,
  "width": 17,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#........D....#.#",
    "#.#.###.#.r#..#.#",
    "#.............#.#",
    "#......g..##.##.#",
    "#.#..gg.........#",
    "#.#.#g........#.#",
    "#.#.#.........#.#",
    "#.#.###.##....#.#",
    "#..............o#",
    "#################"
  ],
  "decor": [
    "                 ",
    "   .`,=*+   .` = ",
    " = + + . ,= + +  ",
    "  .`,=*+   .`, * ",
    "+*+   .`,=     . ",
    " . ,=*+   .`,=*+ ",
    " +   .`,=*+    ` ",
    " ` = +   .`,=*   ",
    "+      =     . , ",
    " ,=*+   .`,=*+   ",
    "                +"
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
      "id": "ch08-s08-ghost-express-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 6,
      "y": 4,
      "breed": "bombay",
      "patrol": 1,
      "facing": 0.04
    },
    {
      "type": "cat",
      "x": 1,
      "y": 7,
      "breed": "savannah",
      "patrol": 2,
      "facing": 2.61
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 8,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 4,
      "kind": "fan"
    },
    {
      "type": "key",
      "x": 7,
      "y": 9,
      "keyId": "ch08-s08-ghost-express-key"
    },
    {
      "type": "door",
      "x": 9,
      "y": 1,
      "id": "ch08-s08-ghost-express-door",
      "locked": true,
      "keyId": "ch08-s08-ghost-express-key"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 2,
      "radius": 5,
      "intensity": 0.66,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 4,
      "radius": 4.2,
      "intensity": 0.54,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 5,
      "radius": 3.5,
      "intensity": 0.76,
      "flicker": 0.16,
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
      "pauseSeconds": 0.68,
      "points": [
        {
          "x": 6,
          "y": 4
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 13,
          "y": 8
        },
        {
          "x": 1,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.48,
      "points": [
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 13,
          "y": 8
        },
        {
          "x": 1,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Ghost Express. The turnstile keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the turnstile. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the turnstile. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Ghost Express banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The turnstile keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the turnstile considers creaking.",
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
        "x": 9,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 5
      },
      {
        "x": 5,
        "y": 4
      },
      {
        "x": 12,
        "y": 9
      },
      {
        "x": 3,
        "y": 1
      }
    ],
    "aggression": 0.88,
    "scentBias": 0.67,
    "hearingBias": 0.68,
    "campHoleChance": 0.24,
    "leashRadius": 14
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 7,
      "optional": false,
      "label": "Bank 7 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 7,
  "parTime": 144,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6.9,
  "music": "subway-last",
  "tags": [
    "subway",
    "maze",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
