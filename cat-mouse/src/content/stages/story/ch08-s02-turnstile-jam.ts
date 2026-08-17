import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s02-turnstile-jam",
  "chapter": 8,
  "index": 2,
  "name": "Turnstile Jam",
  "theme": "subway",
  "kind": "story",
  "seed": 1549407950,
  "width": 16,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "################",
    "#.............##",
    "#.#.....#####.##",
    "#........p#...##",
    "#.#.....###.#.##",
    "#.......#...#.##",
    "#.........###.##",
    "#........D....##",
    "#.##...g.##.####",
    "#............o##",
    "################",
    "################"
  ],
  "decor": [
    "                ",
    " .`,=*+   .`,=  ",
    " +   .`,        ",
    " `,=*+   . ,=*  ",
    "    .`,=     .  ",
    " ,=*+   +`,= +  ",
    "   .`,=*+    `  ",
    " =*+   .` =*+   ",
    "+   ,=*+   .+++ ",
    " *+   .`,=*+    ",
    "                ",
    "          +     "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 9,
      "id": "ch08-s02-turnstile-jam-hole"
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 9,
      "breed": "siamese",
      "patrol": 1,
      "facing": 2.27
    },
    {
      "type": "cat",
      "x": 4,
      "y": 7,
      "breed": "abyssinian",
      "patrol": 2,
      "facing": 5.7
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 1,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 8,
      "kind": "fan"
    },
    {
      "type": "key",
      "x": 11,
      "y": 4,
      "keyId": "ch08-s02-turnstile-jam-key"
    },
    {
      "type": "door",
      "x": 9,
      "y": 7,
      "id": "ch08-s02-turnstile-jam-door",
      "locked": true,
      "keyId": "ch08-s02-turnstile-jam-key"
    },
    {
      "type": "decorProp",
      "x": 9,
      "y": 6,
      "note": "kiosk"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 6,
      "radius": 5,
      "intensity": 0.85,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 7,
      "radius": 3.9,
      "intensity": 0.59,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 4,
      "radius": 4.3,
      "intensity": 0.55,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 8,
      "radius": 5.7,
      "intensity": 0.43,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "loop": false,
      "pauseSeconds": 0.41,
      "points": [
        {
          "x": 8,
          "y": 9
        },
        {
          "x": 11,
          "y": 8
        },
        {
          "x": 3,
          "y": 1
        },
        {
          "x": 4,
          "y": 7
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.58,
      "points": [
        {
          "x": 4,
          "y": 7
        },
        {
          "x": 11,
          "y": 8
        },
        {
          "x": 3,
          "y": 1
        },
        {
          "x": 11,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Turnstile Jam. The turnstile keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
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
      "line": "Half of 6. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Turnstile Jam banked. Whiskers attached."
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
        "x": 13,
        "y": 8
      },
      {
        "x": 4,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 4,
        "y": 5
      },
      {
        "x": 8,
        "y": 6
      },
      {
        "x": 5,
        "y": 9
      },
      {
        "x": 3,
        "y": 9
      }
    ],
    "aggression": 0.87,
    "scentBias": 0.77,
    "hearingBias": 0.56,
    "campHoleChance": 0.22,
    "leashRadius": 14
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 6,
      "optional": false,
      "label": "Bank 6 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 6,
  "parTime": 136,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6.1,
  "music": "subway-last",
  "tags": [
    "subway",
    "maze",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
