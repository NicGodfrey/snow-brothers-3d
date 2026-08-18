import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-14-carnival-spin",
  "chapter": 0,
  "index": 14,
  "name": "Carnival Spin",
  "theme": "cellar",
  "kind": "arcade",
  "seed": 1852215931,
  "width": 24,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#..........##..........#",
    "#.r........##..........#",
    "#..........##.g........#",
    "#......................#",
    "#..........##..........#",
    "#..........##..........#",
    "#......................#",
    "#......................#",
    "#..........##..........#",
    "#.....................o#",
    "########################"
  ],
  "decor": [
    "  +                     ",
    "   .`,=*+   .`,=*+   .` ",
    " =*+   .`,=     .`,=*+  ",
    "  .`,=*+     ,=*+   .`, ",
    " *+   .`,=* +  .`,=*+   ",
    " .`,=*+   .`,=*+   .`,= ",
    " +   .`,=*+   .`,=*+    ",
    " `,=*+   .`  *+   .`,=* ",
    "    .`,=*+   .`,=*+   . ",
    " ,=*+   .`,=*+   .`,=*+ ",
    "   .`,=*+    `,=*+   .` ",
    " =*+   .`,=*+   .`,=*+ +",
    "  +           +         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 11,
      "id": "arcade-14-carnival-spin-hole"
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 21,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 10,
      "breed": "tabby",
      "patrol": 1,
      "facing": 0.95
    },
    {
      "type": "cat",
      "x": 17,
      "y": 10,
      "breed": "britishShorthair",
      "patrol": 2,
      "facing": 4.85
    },
    {
      "type": "powerUp",
      "x": 22,
      "y": 6,
      "kind": "featherFoot"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 5,
      "radius": 5.1,
      "intensity": 0.45,
      "flicker": 0.27,
      "on": true
    },
    {
      "x": 3,
      "y": 2,
      "radius": 3.3,
      "intensity": 0.4,
      "flicker": 0,
      "on": true
    },
    {
      "x": 22,
      "y": 11,
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
      "pauseSeconds": 1.64,
      "points": [
        {
          "x": 8,
          "y": 10
        },
        {
          "x": 17,
          "y": 10
        },
        {
          "x": 11,
          "y": 5
        },
        {
          "x": 15,
          "y": 8
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.8,
      "points": [
        {
          "x": 17,
          "y": 10
        },
        {
          "x": 11,
          "y": 5
        },
        {
          "x": 15,
          "y": 8
        },
        {
          "x": 22,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Carnival Spin. The furnace keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the furnace. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the furnace. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in cellar. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. dual heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Carnival Spin banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The furnace keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the furnace considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 10
      },
      {
        "x": 11,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 11,
        "y": 11
      },
      {
        "x": 21,
        "y": 3
      },
      {
        "x": 10,
        "y": 9
      },
      {
        "x": 16,
        "y": 3
      }
    ],
    "aggression": 0.68,
    "scentBias": 0.41,
    "hearingBias": 0.8,
    "campHoleChance": 0.21,
    "leashRadius": 10
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
  "parTime": 140,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 4.7,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "dual",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
