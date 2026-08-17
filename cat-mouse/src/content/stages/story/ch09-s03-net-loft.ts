import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s03-net-loft",
  "chapter": 9,
  "index": 3,
  "name": "Net Loft",
  "theme": "docks",
  "kind": "story",
  "seed": 4206593742,
  "width": 19,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.................#",
    "#.................#",
    "#..X..............#",
    "#......XXXX.......#",
    "#......XXXX.......#",
    "#.................#",
    "#..LL.....L.......#",
    "#..LL.....XXX.LL..#",
    "#..LL....LLLL.LL..#",
    "#....L...LLLL.LL..#",
    "#........LLLL.....#",
    "#.................#",
    "#.................#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "    +      +       ",
    " ,=*+   .`,=*+   . ",
    "   .`,=*+   .`,=*+ ",
    " =*+   .`,=*+   .` ",
    "  . ,=*+   .`,=*+  ",
    " *+   .    +   .`, ",
    " .`,=*+ ===`,=*+   ",
    " +   .`,=*+   .`,= ",
    " `,=*+   .`,=*+    ",
    "    .`,=*+=  .`,=* ",
    " ,=*+   .`,=*+   . ",
    "+  .`,=*+   .`,=*+ ",
    " =*+   .`,=*+   .` ",
    "  .`,=*+   .`,=*+  ",
    " *+   .`,=*+   .`, ",
    " .`,=*+   .`,=*+   ",
    "   +    +   +      "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 15,
      "id": "ch09-s03-net-loft-hole"
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 7,
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
      "x": 8,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 17,
      "y": 6,
      "breed": "norwegianForest",
      "patrol": 1,
      "facing": 0.67
    },
    {
      "type": "cat",
      "x": 10,
      "y": 2,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 5.97
    },
    {
      "type": "powerUp",
      "x": 16,
      "y": 10,
      "kind": "extraLife"
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 3,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 17,
      "y": 4,
      "note": "pier"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 10,
      "radius": 4.2,
      "intensity": 0.65,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 11,
      "radius": 6.1,
      "intensity": 0.78,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 4,
      "radius": 4.5,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 15,
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
      "pauseSeconds": 1.31,
      "points": [
        {
          "x": 17,
          "y": 6
        },
        {
          "x": 10,
          "y": 2
        },
        {
          "x": 16,
          "y": 10
        },
        {
          "x": 17,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.27,
      "points": [
        {
          "x": 10,
          "y": 2
        },
        {
          "x": 16,
          "y": 10
        },
        {
          "x": 17,
          "y": 4
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
      "line": "Net Loft. The cold storage keeps a second set of books."
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
      "line": "Sneak the cold storage. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the cold storage. Heavy. Mine until the hole says otherwise."
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
      "line": "Net Loft banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The cold storage keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the cold storage considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 14
      },
      {
        "x": 16,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 16,
        "y": 6
      },
      {
        "x": 1,
        "y": 11
      },
      {
        "x": 6,
        "y": 2
      },
      {
        "x": 6,
        "y": 7
      }
    ],
    "aggression": 0.86,
    "scentBias": 0.61,
    "hearingBias": 0.45,
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
  "parTime": 157,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 7,
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
