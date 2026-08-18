import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch02-s07-rafter-run",
  "chapter": 2,
  "index": 7,
  "name": "Rafter Run",
  "theme": "cellar",
  "kind": "story",
  "seed": 349336909,
  "width": 24,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#....................###",
    "#......#.~.r..#......###",
    "#.............#......###",
    "#......#.~....#......###",
    "#......#.~....#......###",
    "#......#.~....#......###",
    "#......#.~...........###",
    "#......#.~....#......###",
    "#......#.~....#......###",
    "#......#.~....#......###",
    "#........~....#......###",
    "#......#.~....#......###",
    "#......#.~....#......###",
    "#...................o###",
    "########################"
  ],
  "decor": [
    "    +                   ",
    "   .`,=*+   .`,=*+      ",
    " =*+    `,=*+   .`,=*   ",
    "  .`,=*+   .`, *+   .   ",
    " *+   . ,=*+   .`,=*++  ",
    " .`,=*+   .`,= +   .`   ",
    " +   .` =*+    `,=*+  + ",
    " `,=*+   .`,=*+   .`,   ",
    "    .`, *+   . ,=*+     ",
    " ,=*+  +.`,=*+   .`,=   ",
    "   .`,= +   .` =*+      ",
    " =*+   .`,=*+ + .`,=*   ",
    "+ .`,=*    .`,+*+   .   ",
    " *+   . ,=*+   .`,=*+   ",
    " .`,=*+   .`,=*+   .`   ",
    "                        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 20,
      "y": 14,
      "id": "ch02-s07-rafter-run-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 8,
      "value": 1,
      "guarded": false
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
      "x": 18,
      "y": 5,
      "breed": "ragdoll",
      "patrol": 1,
      "facing": 5.92
    },
    {
      "type": "powerUp",
      "x": 10,
      "y": 9,
      "kind": "noiseBomb"
    }
  ],
  "lights": [
    {
      "x": 13,
      "y": 11,
      "radius": 4,
      "intensity": 0.58,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 9,
      "radius": 5.6,
      "intensity": 0.47,
      "flicker": 0.32,
      "on": true
    },
    {
      "x": 11,
      "y": 5,
      "radius": 5.9,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
      "y": 4,
      "radius": 5.6,
      "intensity": 0.76,
      "flicker": 0,
      "on": true
    },
    {
      "x": 20,
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
      "pauseSeconds": 1.64,
      "points": [
        {
          "x": 18,
          "y": 5
        },
        {
          "x": 10,
          "y": 9
        },
        {
          "x": 13,
          "y": 11
        },
        {
          "x": 18,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Rafter Run. The jar wall keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the jar wall. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the jar wall. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in cellar. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Rafter Run banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The jar wall keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the jar wall considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 20,
        "y": 13
      },
      {
        "x": 2,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 11
      },
      {
        "x": 18,
        "y": 14
      },
      {
        "x": 17,
        "y": 8
      },
      {
        "x": 10,
        "y": 3
      }
    ],
    "aggression": 0.62,
    "scentBias": 0.84,
    "hearingBias": 0.54,
    "campHoleChance": 0.07,
    "leashRadius": 8
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 4,
  "parTime": 132,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 2.5,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "channels",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
