import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s03-wet-bricks",
  "chapter": 3,
  "index": 3,
  "name": "Wet Bricks",
  "theme": "alley",
  "kind": "story",
  "seed": 2904300534,
  "width": 23,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#..................r..#",
    "#.......##............#",
    "#.....................#",
    "#....g..##............#",
    "#.......##.........X..#",
    "#.....................#",
    "#.......##......gg..g.#",
    "#.......##............#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "                       ",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+    `,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,=*+     ,=*+   .`,=* ",
    "   .`,=*    .`,=*+ = . ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`  *+   .`,=*+  ",
    " .`,=*+   .`,=*+   .`, ",
    "                       "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 9,
      "id": "ch03-s03-wet-bricks-hole"
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 1,
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
      "x": 4,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 10,
      "y": 9,
      "breed": "bengal",
      "patrol": 1,
      "facing": 1.1
    },
    {
      "type": "powerUp",
      "x": 20,
      "y": 6,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 5,
      "kind": "glueBoard"
    }
  ],
  "lights": [
    {
      "x": 20,
      "y": 3,
      "radius": 4.3,
      "intensity": 0.53,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 21,
      "y": 5,
      "radius": 3.8,
      "intensity": 0.7,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
      "y": 1,
      "radius": 4.3,
      "intensity": 0.74,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 6,
      "radius": 6.1,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
      "y": 9,
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
      "pauseSeconds": 1.66,
      "points": [
        {
          "x": 10,
          "y": 9
        },
        {
          "x": 20,
          "y": 6
        },
        {
          "x": 10,
          "y": 5
        },
        {
          "x": 20,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Wet Bricks. The dumpster keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the dumpster. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the dumpster. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Wet Bricks banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The dumpster keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the dumpster considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 8
      },
      {
        "x": 12,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 3
      },
      {
        "x": 7,
        "y": 6
      },
      {
        "x": 15,
        "y": 1
      },
      {
        "x": 3,
        "y": 8
      }
    ],
    "aggression": 0.7,
    "scentBias": 0.58,
    "hearingBias": 0.46,
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
  "parTime": 119,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 2.8,
  "music": "alley-neon",
  "tags": [
    "alley",
    "dual",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
