import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s02-bumper-floor",
  "chapter": 6,
  "index": 2,
  "name": "Bumper Floor",
  "theme": "carnival",
  "kind": "story",
  "seed": 560974637,
  "width": 15,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#......GGGG...#",
    "#......GGGG...#",
    "#.............#",
    "#..G.GGG......#",
    "#.....GG..T...#",
    "#.......T.....#",
    "#.XXXXX.......#",
    "#.XXTTX.TTT...#",
    "#.............#",
    "#.XXXXr.TTT...#",
    "#.............#",
    "#.............#",
    "#............o#",
    "###############"
  ],
  "decor": [
    "               ",
    "    .`,=*+   . ",
    " ,=*+   .`,=*+ ",
    "   .`,=*+   .` ",
    " =*+   .`,=*+  ",
    "  .`,=*+   .`, ",
    " *+   .`,= +   ",
    "+.`,=*+   .`,= ",
    " + =   ,=*+    ",
    " `       = ,=* ",
    "    .`,=*+   . ",
    " ,   =  = ==*++",
    "   .`,=*+   .` ",
    " =*+   .`,=*+  ",
    "  .`,=*+   .`, ",
    "             + "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 14,
      "id": "ch06-s02-bumper-floor-hole"
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 12,
      "value": 1,
      "guarded": true
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
      "x": 5,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 9,
      "y": 12,
      "breed": "bengal",
      "patrol": 1,
      "facing": 5.08
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 3,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 5,
      "y": 2,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 14,
      "kind": "broom"
    },
    {
      "type": "decorProp",
      "x": 6,
      "y": 7,
      "note": "prize tent"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 5,
      "radius": 4.3,
      "intensity": 0.89,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 2,
      "radius": 4.3,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 4,
      "y": 4,
      "radius": 5.7,
      "intensity": 0.65,
      "flicker": 0.11,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 1.13,
      "points": [
        {
          "x": 9,
          "y": 12
        },
        {
          "x": 7,
          "y": 3
        },
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 2,
          "y": 14
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Bumper Floor. The prize tent keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the prize tent. Dash is postage. The islands layout lies about shortcuts.",
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
      "line": "Half of 5. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Bumper Floor banked. Whiskers attached."
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
        "x": 13,
        "y": 13
      },
      {
        "x": 12,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 1
      },
      {
        "x": 8,
        "y": 12
      },
      {
        "x": 12,
        "y": 9
      },
      {
        "x": 5,
        "y": 6
      }
    ],
    "aggression": 0.77,
    "scentBias": 0.45,
    "hearingBias": 0.79,
    "campHoleChance": 0.08,
    "leashRadius": 12
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
  "parTime": 126,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 4.7,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "islands",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
