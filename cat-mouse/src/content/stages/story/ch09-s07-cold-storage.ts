import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s07-cold-storage",
  "chapter": 9,
  "index": 7,
  "name": "Cold Storage",
  "theme": "docks",
  "kind": "story",
  "seed": 2074929141,
  "width": 24,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#......................#",
    "#......................#",
    "#......................#",
    "#.##.###.###.#####.#####",
    "#......................#",
    "#......................#",
    "#......................#",
    "#.....................o#",
    "########################",
    "########################",
    "########################"
  ],
  "decor": [
    "  +                     ",
    " +   .`,=*+   .`,=*+   +",
    " `,=*+   .`,=*+   .`,=* ",
    "    .`,=*+   .`,=*+   . ",
    " ,=*+   .`,=*+   .`,=*++",
    "    `   +  +.           ",
    " =*+   .`,=*+   .`,=*+  ",
    "  .`,=*+   .`,=*+   .`, ",
    " *+   .`,=*+   .`,=*+   ",
    " .`,=*+   .`,=*+   .`,= ",
    "          +  +          ",
    "       +           +    ",
    "              +    +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 9,
      "id": "ch09-s07-cold-storage-hole"
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 21,
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
      "x": 1,
      "y": 8,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 8,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 12,
      "y": 7,
      "breed": "norwegianForest",
      "patrol": 1,
      "facing": 5.1
    },
    {
      "type": "cat",
      "x": 18,
      "y": 2,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 3.81
    },
    {
      "type": "powerUp",
      "x": 6,
      "y": 4,
      "kind": "magnet"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 4,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 7,
      "y": 4,
      "note": "cold storage"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 3,
      "radius": 4.9,
      "intensity": 0.63,
      "flicker": 0.23,
      "on": true
    },
    {
      "x": 12,
      "y": 3,
      "radius": 4.5,
      "intensity": 0.9,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 2,
      "radius": 5,
      "intensity": 0.45,
      "flicker": 0,
      "on": true
    },
    {
      "x": 22,
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
      "pauseSeconds": 1.49,
      "points": [
        {
          "x": 12,
          "y": 7
        },
        {
          "x": 18,
          "y": 2
        },
        {
          "x": 6,
          "y": 4
        },
        {
          "x": 4,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.13,
      "points": [
        {
          "x": 18,
          "y": 2
        },
        {
          "x": 6,
          "y": 4
        },
        {
          "x": 4,
          "y": 4
        },
        {
          "x": 8,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Cold Storage. The gangway keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the gangway. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the gangway. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Cold Storage banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The gangway keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the gangway considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 8
      },
      {
        "x": 5,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 5,
        "y": 7
      },
      {
        "x": 8,
        "y": 7
      },
      {
        "x": 21,
        "y": 4
      },
      {
        "x": 12,
        "y": 9
      }
    ],
    "aggression": 0.99,
    "scentBias": 0.42,
    "hearingBias": 0.8,
    "campHoleChance": 0.28,
    "leashRadius": 15
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 8,
      "optional": false,
      "label": "Bank 8 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 8,
  "parTime": 164,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 7.4,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "channels",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
