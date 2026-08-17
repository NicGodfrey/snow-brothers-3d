import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s04-foghorn-bay",
  "chapter": 9,
  "index": 4,
  "name": "Foghorn Bay",
  "theme": "docks",
  "kind": "story",
  "seed": 4291339365,
  "width": 16,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#..........L...#",
    "#..LLLL.XXX....#",
    "#..............#",
    "#..LLLL.XXX....#",
    "#..............#",
    "#....pp.pp.....#",
    "#..............#",
    "#.LLLLLppp.....#",
    "#.LLLLL........#",
    "#..............#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "      +       + ",
    "  .`,=*+   .`,= ",
    " *+   .`,=*+    ",
    " .`,=*+ =  `,=* ",
    " +   .`,=*+   . ",
    "+`,=*+     ,=*+ ",
    "    .`,=*+   .` ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`,+",
    " =*+   .`,=*+  +",
    "  .`,=*+   .`,=+",
    " *+   .`,=*+    ",
    "+.`,=*+   .`,=* ",
    " +   .`,=*+   . ",
    "         +      "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 13,
      "id": "ch09-s04-foghorn-bay-hole"
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 13,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 6,
      "y": 7,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 0.63
    },
    {
      "type": "cat",
      "x": 3,
      "y": 13,
      "breed": "sphynx",
      "patrol": 2,
      "facing": 1.75
    },
    {
      "type": "powerUp",
      "x": 4,
      "y": 4,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 8,
      "kind": "water"
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 13,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 12,
      "note": "pier"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 1,
      "radius": 4.8,
      "intensity": 0.58,
      "flicker": 0.14,
      "on": true
    },
    {
      "x": 12,
      "y": 10,
      "radius": 3.8,
      "intensity": 0.65,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 13,
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
      "pauseSeconds": 1.62,
      "points": [
        {
          "x": 6,
          "y": 7
        },
        {
          "x": 3,
          "y": 13
        },
        {
          "x": 4,
          "y": 4
        },
        {
          "x": 4,
          "y": 8
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.36,
      "points": [
        {
          "x": 3,
          "y": 13
        },
        {
          "x": 4,
          "y": 4
        },
        {
          "x": 4,
          "y": 8
        },
        {
          "x": 10,
          "y": 13
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Foghorn Bay. The pier keeps a second set of books."
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
      "line": "Sneak the pier. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pier. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Foghorn Bay banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pier keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pier considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 12
      },
      {
        "x": 11,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 11,
        "y": 4
      },
      {
        "x": 4,
        "y": 6
      },
      {
        "x": 1,
        "y": 8
      },
      {
        "x": 7,
        "y": 7
      }
    ],
    "aggression": 0.94,
    "scentBias": 0.4,
    "hearingBias": 0.68,
    "campHoleChance": 0.28,
    "leashRadius": 15
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
  "parTime": 149,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 7.1,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "islands",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
