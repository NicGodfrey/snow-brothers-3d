import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s08-prize-tent",
  "chapter": 6,
  "index": 8,
  "name": "Prize Tent",
  "theme": "carnival",
  "kind": "story",
  "seed": 1260413255,
  "width": 22,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "######################",
    "#....................#",
    "#..G...X.......T.....#",
    "#....................#",
    "#....................#",
    "#....................#",
    "#.######.######.##.###",
    "#....................#",
    "#...T....X....g......#",
    "#....................#",
    "#....................#",
    "#....................#",
    "#...................o#",
    "######################"
  ],
  "decor": [
    "       +              ",
    "    .`,=*+   .`,=*+   ",
    "+,=*+   .`,=*+   .`,= ",
    "   .`,=*+   .`,=*+    ",
    " =*+   .`,=*+   .`,=* ",
    "  .`,=*+   .`,=*+   .+",
    " *      ,  +   .  =  +",
    " .`,=*+   .`,=*+   .` ",
    " +   .`,= +   .`,=*+  ",
    " `,=*+   .`,=*+   .`, ",
    "    .`,=*+   .`,=*+   ",
    " ,=*+   .`,=*+   .`,= ",
    "   .`,=*+   .`,=*+    ",
    " +           ++   +   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 20,
      "y": 12,
      "id": "ch06-s08-prize-tent-hole"
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 7,
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
      "x": 8,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 5,
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
      "x": 11,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 5,
      "y": 2,
      "breed": "calico",
      "patrol": 1,
      "facing": 5
    },
    {
      "type": "powerUp",
      "x": 11,
      "y": 10,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 1,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 19,
      "y": 4,
      "kind": "fan"
    }
  ],
  "lights": [
    {
      "x": 15,
      "y": 3,
      "radius": 5.3,
      "intensity": 0.68,
      "flicker": 0.33,
      "on": true
    },
    {
      "x": 2,
      "y": 10,
      "radius": 6.1,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
      "y": 3,
      "radius": 3.7,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 20,
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
      "loop": false,
      "pauseSeconds": 1.22,
      "points": [
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 11,
          "y": 10
        },
        {
          "x": 11,
          "y": 1
        },
        {
          "x": 19,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Prize Tent. The prize tent keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the prize tent. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the prize tent. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Prize Tent banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The prize tent keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the prize tent considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 20,
        "y": 11
      },
      {
        "x": 18,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 18,
        "y": 7
      },
      {
        "x": 1,
        "y": 11
      },
      {
        "x": 8,
        "y": 4
      },
      {
        "x": 18,
        "y": 1
      }
    ],
    "aggression": 0.82,
    "scentBias": 0.37,
    "hearingBias": 0.45,
    "campHoleChance": 0.19,
    "leashRadius": 12
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
  "parTime": 141,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 5.5,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "galleries",
    "story",
    "solo-cat",
    "q6"
  ]
};

export default stage;
