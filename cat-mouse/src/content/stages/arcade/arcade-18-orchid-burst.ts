import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-18-orchid-burst",
  "chapter": 0,
  "index": 18,
  "name": "Orchid Burst",
  "theme": "carnival",
  "kind": "arcade",
  "seed": 63408122,
  "width": 16,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#....r..##.....#",
    "#.......##.....#",
    "#..............#",
    "#.......##.....#",
    "#.......##.....#",
    "#.......##.....#",
    "#......X##.....#",
    "#.......##.....#",
    "#....r.........#",
    "#....g..##.....#",
    "#.......##.....#",
    "#.......##....o#",
    "################"
  ],
  "decor": [
    "         +      ",
    " .`,=*+   .`,=* ",
    " +   .`, ++   . ",
    " `,=*+    `,=*+ ",
    "    .`,=*+   .` ",
    " ,=*+     ,=*+ +",
    "   .`,=*    .`,+",
    " =*+   . +=*+   ",
    "  .`,=*    .`,= ",
    " *+   .`  *+    ",
    " .`,=*+   .`,=* ",
    " +   .`,  +   . ",
    " `,=*+    `,=*+ ",
    "    .`,=     .` ",
    "         ++  +  "
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
      "id": "arcade-18-orchid-burst-hole"
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 11,
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
      "x": 10,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 14,
      "y": 5,
      "breed": "calico",
      "patrol": 1,
      "facing": 3.32
    },
    {
      "type": "cat",
      "x": 4,
      "y": 6,
      "breed": "manx",
      "patrol": 2,
      "facing": 3.71
    },
    {
      "type": "powerUp",
      "x": 10,
      "y": 8,
      "kind": "decoy"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 10,
      "radius": 4.9,
      "intensity": 0.8,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 9,
      "radius": 4,
      "intensity": 0.62,
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
      "pauseSeconds": 0.6,
      "points": [
        {
          "x": 14,
          "y": 5
        },
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 10,
          "y": 8
        },
        {
          "x": 4,
          "y": 10
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.01,
      "points": [
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 10,
          "y": 8
        },
        {
          "x": 4,
          "y": 10
        },
        {
          "x": 13,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Orchid Burst. The mirrors keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the mirrors. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the mirrors. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
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
      "line": "Orchid Burst banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The mirrors keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the mirrors considers creaking.",
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
        "x": 14,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 14,
        "y": 4
      },
      {
        "x": 10,
        "y": 11
      },
      {
        "x": 12,
        "y": 9
      },
      {
        "x": 10,
        "y": 1
      }
    ],
    "aggression": 0.67,
    "scentBias": 0.68,
    "hearingBias": 0.53,
    "campHoleChance": 0.3,
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
  "parTime": 133,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 5.2,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "dual",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
