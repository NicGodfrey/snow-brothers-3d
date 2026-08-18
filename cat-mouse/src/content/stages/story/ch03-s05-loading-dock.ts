import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s05-loading-dock",
  "chapter": 3,
  "index": 5,
  "name": "Loading Dock",
  "theme": "alley",
  "kind": "story",
  "seed": 2550059759,
  "width": 16,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#..............#",
    "#..#########...#",
    "#..#~~~~~~~~#..#",
    "#.G#~~~~~~~~#..#",
    "#..#~~~~~~~~#..#",
    "#...~~~~~~~~#..#",
    "#..######.###..#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "        +       ",
    "    .`,=*+   .` ",
    " ,=*+   .`,=*+  ",
    "            .`, ",
    " =*    .`,=*    ",
    "  . ,=*+   . ,= ",
    " *+   .`,=*+    ",
    " .`,=*+   .` =* ",
    " +       *    . ",
    " `,=*+   .`,=*+ ",
    "    .`,=*+   .` ",
    " +        +     "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 10,
      "id": "ch03-s05-loading-dock-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 8,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 7,
      "y": 6,
      "breed": "bombay",
      "patrol": 1,
      "facing": 0.91
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 10,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 6,
      "y": 1,
      "kind": "broom"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 3,
      "radius": 5.5,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 6,
      "radius": 3.2,
      "intensity": 0.57,
      "flicker": 0.18,
      "on": true
    },
    {
      "x": 4,
      "y": 7,
      "radius": 4.5,
      "intensity": 0.87,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
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
      "loop": false,
      "pauseSeconds": 0.62,
      "points": [
        {
          "x": 7,
          "y": 6
        },
        {
          "x": 1,
          "y": 3
        },
        {
          "x": 8,
          "y": 10
        },
        {
          "x": 6,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Loading Dock. The fire escape keeps a second set of books."
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
      "line": "Sneak the fire escape. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the fire escape. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Loading Dock banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The fire escape keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the fire escape considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 9
      },
      {
        "x": 1,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 4
      },
      {
        "x": 2,
        "y": 8
      },
      {
        "x": 3,
        "y": 1
      },
      {
        "x": 9,
        "y": 9
      }
    ],
    "aggression": 0.6,
    "scentBias": 0.63,
    "hearingBias": 0.45,
    "campHoleChance": 0.18,
    "leashRadius": 9
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
  "parTime": 113,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 3,
  "music": "alley-neon",
  "tags": [
    "alley",
    "ring",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
