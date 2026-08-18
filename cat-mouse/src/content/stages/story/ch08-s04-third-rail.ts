import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s04-third-rail",
  "chapter": 8,
  "index": 4,
  "name": "Third Rail",
  "theme": "subway",
  "kind": "story",
  "seed": 3690116945,
  "width": 19,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.............s...#",
    "#....##.######....#",
    "#...###.#######...#",
    "#.................#",
    "#...###.#######...#",
    "#...###.#.#####...#",
    "#...............g.#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "                   ",
    " .`,=*+   .`,=*+   ",
    "++   .`,=*+   .`,= ",
    " `,=*++     + +    ",
    "       =   +   ,=* ",
    " ,=*+   .`,=*+   . ",
    "   .   *    +  =*+ ",
    " =*+   . ,      .`+",
    "  .`,=*+   .`,=*+  ",
    " *+   .`,=*+   .`, ",
    "                   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 9,
      "id": "ch08-s04-third-rail-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 11,
      "y": 8,
      "breed": "bombay",
      "patrol": 1,
      "facing": 6.03
    },
    {
      "type": "cat",
      "x": 2,
      "y": 8,
      "breed": "savannah",
      "patrol": 2,
      "facing": 5.16
    },
    {
      "type": "powerUp",
      "x": 16,
      "y": 8,
      "kind": "magnet"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 5,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 1,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 1,
      "radius": 5.3,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 4,
      "y": 3,
      "radius": 4.1,
      "intensity": 0.86,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 9,
      "radius": 5.6,
      "intensity": 0.58,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "pauseSeconds": 1.69,
      "points": [
        {
          "x": 11,
          "y": 8
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 16,
          "y": 8
        },
        {
          "x": 2,
          "y": 8
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.66,
      "points": [
        {
          "x": 2,
          "y": 8
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 16,
          "y": 8
        },
        {
          "x": 1,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Third Rail. The platform keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the platform. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the platform. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Third Rail banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The platform keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the platform considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 8
      },
      {
        "x": 1,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 6
      },
      {
        "x": 12,
        "y": 2
      },
      {
        "x": 16,
        "y": 5
      },
      {
        "x": 8,
        "y": 1
      }
    ],
    "aggression": 0.9,
    "scentBias": 0.49,
    "hearingBias": 0.44,
    "campHoleChance": 0.26,
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
  "parTime": 138,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6.4,
  "music": "subway-last",
  "tags": [
    "subway",
    "ring",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
