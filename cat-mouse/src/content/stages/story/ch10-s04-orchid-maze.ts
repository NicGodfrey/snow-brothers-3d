import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s04-orchid-maze",
  "chapter": 10,
  "index": 4,
  "name": "Orchid Maze",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 2904397309,
  "width": 16,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#.......XXXX...#",
    "#..r...GGGGXD..#",
    "#..............#",
    "#..............#",
    "#.GG...XXXGGG..#",
    "#.GG..TTXX.....#",
    "#..G..TTXX.....#",
    "#..............#",
    "#..............#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "                ",
    "   .`,=*+   .`, ",
    " =*+   .    +   ",
    "  .`,=*+     ,= ",
    " *+   .`,=*+    ",
    " .`,=*+   .`,=* ",
    " +   .`=  +   . ",
    " `,=*+ =  `,=*+ ",
    "    .`       .` ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "  .`,=*+   .`,= ",
    "                "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 12,
      "id": "ch10-s04-orchid-maze-hole"
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
      "x": 3,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 8,
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
      "x": 1,
      "y": 11,
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
      "x": 13,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 5,
      "y": 6,
      "breed": "calico",
      "patrol": 1,
      "facing": 2.07
    },
    {
      "type": "cat",
      "x": 6,
      "y": 9,
      "breed": "scottishFold",
      "patrol": 2,
      "facing": 5.84
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 10,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 12,
      "kind": "water"
    },
    {
      "type": "key",
      "x": 14,
      "y": 4,
      "keyId": "ch10-s04-orchid-maze-key"
    },
    {
      "type": "door",
      "x": 12,
      "y": 3,
      "id": "ch10-s04-orchid-maze-door",
      "locked": true,
      "keyId": "ch10-s04-orchid-maze-key"
    },
    {
      "type": "decorProp",
      "x": 14,
      "y": 11,
      "note": "mist"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 1,
      "radius": 4,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 10,
      "radius": 5.9,
      "intensity": 0.52,
      "flicker": 0.11,
      "on": true
    },
    {
      "x": 14,
      "y": 12,
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
          "x": 5,
          "y": 6
        },
        {
          "x": 14,
          "y": 11
        },
        {
          "x": 6,
          "y": 9
        },
        {
          "x": 1,
          "y": 12
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.71,
      "points": [
        {
          "x": 6,
          "y": 9
        },
        {
          "x": 14,
          "y": 11
        },
        {
          "x": 1,
          "y": 12
        },
        {
          "x": 3,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Orchid Maze. The seedlings keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the seedlings. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the seedlings. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
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
      "line": "Orchid Maze banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The seedlings keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the seedlings considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 11
      },
      {
        "x": 7,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 7,
        "y": 9
      },
      {
        "x": 3,
        "y": 2
      },
      {
        "x": 4,
        "y": 6
      },
      {
        "x": 2,
        "y": 8
      }
    ],
    "aggression": 1.04,
    "scentBias": 0.65,
    "hearingBias": 0.65,
    "campHoleChance": 0.23,
    "leashRadius": 16
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
  "parTime": 147,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 7.8,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "islands",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
