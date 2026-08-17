import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s06-ring-toss",
  "chapter": 6,
  "index": 6,
  "name": "Ring Toss",
  "theme": "carnival",
  "kind": "story",
  "seed": 426188129,
  "width": 15,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#...........###",
    "#........#..###",
    "#..#..#..#..###",
    "#..#..#..#..###",
    "#...........###",
    "#..#.....#..###",
    "#..#..#.....###",
    "#..#..#..#..###",
    "#...r.#..#..###",
    "#..#..#..#.o###",
    "###############"
  ],
  "decor": [
    "        +   +  ",
    " =*+   .`,=*   ",
    "  .`,=*+   .   ",
    " *+    `, *++  ",
    " .` =*    .`   ",
    " +   .`,=*+    ",
    "+`,+*+    `,   ",
    "    .` =*+     ",
    " ,= +   . ,=+  ",
    "   .`, *+      ",
    " =*    .`+=*   ",
    "               "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 11,
      "y": 10,
      "id": "ch06-s06-ring-toss-hole"
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 5,
      "y": 5,
      "breed": "bengal",
      "patrol": 1,
      "facing": 5.36
    },
    {
      "type": "powerUp",
      "x": 10,
      "y": 4,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 7,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 8,
      "note": "prize tent"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 3,
      "radius": 5.8,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 8,
      "radius": 4.4,
      "intensity": 0.62,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 10,
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
      "pauseSeconds": 0.7,
      "points": [
        {
          "x": 5,
          "y": 5
        },
        {
          "x": 10,
          "y": 4
        },
        {
          "x": 2,
          "y": 7
        },
        {
          "x": 11,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Ring Toss. The mirrors keeps a second set of books."
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
      "line": "Sneak the mirrors. Dash is postage. The channels layout lies about shortcuts.",
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
      "line": "Half of 6. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Ring Toss banked. Whiskers attached."
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
        "x": 11,
        "y": 9
      },
      {
        "x": 3,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 1
      },
      {
        "x": 7,
        "y": 7
      },
      {
        "x": 4,
        "y": 4
      },
      {
        "x": 11,
        "y": 5
      }
    ],
    "aggression": 0.8,
    "scentBias": 0.71,
    "hearingBias": 0.48,
    "campHoleChance": 0.09,
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
  "parTime": 128,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 5.2,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "channels",
    "story",
    "solo-cat",
    "q6"
  ]
};

export default stage;
