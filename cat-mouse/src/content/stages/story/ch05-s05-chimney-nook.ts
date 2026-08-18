import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s05-chimney-nook",
  "chapter": 5,
  "index": 5,
  "name": "Chimney Nook",
  "theme": "attic",
  "kind": "story",
  "seed": 1705945320,
  "width": 21,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...........#...#####",
    "#...#...#.......#####",
    "#..v#...#...#...#####",
    "#...#...#...#...#####",
    "#.......#...#...#####",
    "#...#...#...#...#####",
    "#...............#####",
    "#...#...#...#...#####",
    "#...#L......#...#####",
    "#...............#####",
    "#...#...#...#...#####",
    "#..............o#####",
    "#####################"
  ],
  "decor": [
    "                     ",
    "  .`,=*+   . ,=*     ",
    " *+   .` =*+   .   + ",
    " .`, *+   .` =*++    ",
    " +   .`, *+   .`     ",
    " `,=*+   .`, *+      ",
    "     `,= +   .`,     ",
    " ,=*+   .`,=*+       ",
    "   . ,=*+    `,=+    ",
    " =*+   .`,=*         ",
    "  .`,=*+   .`,=*     ",
    " *+   .` =*+   .     ",
    " .`,=*+   .`,=*+    +",
    "  +          +   +   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 12,
      "id": "ch05-s05-chimney-nook-hole"
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
      "x": 15,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 1,
      "y": 8,
      "breed": "russianBlue",
      "patrol": 1,
      "facing": 2.23
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 12,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 11,
      "kind": "glueBoard"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 1,
      "radius": 5.7,
      "intensity": 0.68,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 2,
      "radius": 5.2,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
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
      "pauseSeconds": 0.5,
      "points": [
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 13,
          "y": 12
        },
        {
          "x": 9,
          "y": 11
        },
        {
          "x": 3,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Chimney Nook. The chimney keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the chimney. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the chimney. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Chimney Nook banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The chimney keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the chimney considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 11
      },
      {
        "x": 3,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 2
      },
      {
        "x": 15,
        "y": 7
      },
      {
        "x": 3,
        "y": 8
      },
      {
        "x": 3,
        "y": 12
      }
    ],
    "aggression": 0.74,
    "scentBias": 0.6,
    "hearingBias": 0.7,
    "campHoleChance": 0.07,
    "leashRadius": 11
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
  "parTime": 131,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4.4,
  "music": "attic-moths",
  "tags": [
    "attic",
    "channels",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
