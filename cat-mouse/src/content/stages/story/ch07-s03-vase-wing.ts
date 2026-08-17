import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s03-vase-wing",
  "chapter": 7,
  "index": 3,
  "name": "Vase Wing",
  "theme": "museum",
  "kind": "story",
  "seed": 2516510766,
  "width": 17,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#...............#",
    "#....s..........#",
    "#....s..........#",
    "#....s...r......#",
    "#...............#",
    "#.......Tsssss..#",
    "#...GG.GTsssssr.#",
    "#...............#",
    "#...GGGGTsssss..#",
    "#.......G.......#",
    "#...............#",
    "#...D...........#",
    "#..............o#",
    "#################"
  ],
  "decor": [
    "                 ",
    " +   .`,=*+   .` ",
    " `,=*+   .`,=*+  ",
    "    .`,=*+   .`, ",
    " ,=*+   .`,=*+   ",
    "   .`,=*+   .`,= ",
    " =*+   .`,=*+    ",
    "  .`,=*+   .`,=* ",
    " *+   .` =*+   . ",
    " .`,=*+   .`,=*+ ",
    " +   .`, *+   .` ",
    " `,=*+   .`,=*+  ",
    "    .`,=*+   .`, ",
    " ,=*    .`,=*+   ",
    "   .`,=*+   .`,=+",
    "        +        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 14,
      "id": "ch07-s03-vase-wing-hole"
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
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 2,
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
      "x": 14,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 5,
      "y": 9,
      "breed": "russianBlue",
      "patrol": 1,
      "facing": 1.57
    },
    {
      "type": "cat",
      "x": 2,
      "y": 7,
      "breed": "persian",
      "patrol": 2,
      "facing": 2.49
    },
    {
      "type": "powerUp",
      "x": 5,
      "y": 1,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 2,
      "kind": "snapTrap"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 10,
      "kind": "snapTrap"
    },
    {
      "type": "key",
      "x": 13,
      "y": 6,
      "keyId": "ch07-s03-vase-wing-key"
    },
    {
      "type": "door",
      "x": 4,
      "y": 13,
      "id": "ch07-s03-vase-wing-door",
      "locked": true,
      "keyId": "ch07-s03-vase-wing-key"
    },
    {
      "type": "decorProp",
      "x": 8,
      "y": 1,
      "note": "vase"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 14,
      "radius": 5.6,
      "intensity": 0.66,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 7,
      "radius": 4.7,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 14,
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
      "pauseSeconds": 0.61,
      "points": [
        {
          "x": 5,
          "y": 9
        },
        {
          "x": 2,
          "y": 7
        },
        {
          "x": 13,
          "y": 2
        },
        {
          "x": 5,
          "y": 1
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.16,
      "points": [
        {
          "x": 2,
          "y": 7
        },
        {
          "x": 13,
          "y": 2
        },
        {
          "x": 5,
          "y": 1
        },
        {
          "x": 1,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Vase Wing. The vase keeps a second set of books."
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
      "line": "Sneak the vase. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vase. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in museum. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Vase Wing banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vase keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vase considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 13
      },
      {
        "x": 13,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 13,
        "y": 9
      },
      {
        "x": 9,
        "y": 1
      },
      {
        "x": 2,
        "y": 6
      },
      {
        "x": 6,
        "y": 9
      }
    ],
    "aggression": 0.88,
    "scentBias": 0.74,
    "hearingBias": 0.55,
    "campHoleChance": 0.23,
    "leashRadius": 13
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
  "parTime": 144,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 5.6,
  "music": "museum-echo",
  "tags": [
    "museum",
    "islands",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
