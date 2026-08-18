import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-24-last-kettle",
  "chapter": 0,
  "index": 24,
  "name": "Last Kettle",
  "theme": "moonLab",
  "kind": "arcade",
  "seed": 2834380779,
  "width": 15,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.##....###.#.#",
    "#..G..G.......#",
    "#.##......#.###",
    "#.............#",
    "#.#.#...###.#.#",
    "#.G.#.#..D..#.#",
    "#.###.#.###.#.#",
    "#.G.....#...#.#",
    "#.#...###.#.#.#",
    "#............o#",
    "###############",
    "###############"
  ],
  "decor": [
    "      +        ",
    " ,=*+   .`,=*+ ",
    "    `,=*  +  ` ",
    " =*+   .`,=*+  ",
    "+   ,=*+   .   ",
    " *+   .`,=*+   ",
    " . , *+   +` = ",
    " +   . ,==+    ",
    " `   +     , * ",
    "    .`,= +   . ",
    " , *+    ` = + ",
    "   .`,=*+   .` ",
    "               ",
    "+              "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 11,
      "id": "arcade-24-last-kettle-hole"
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 1,
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
      "x": 9,
      "y": 5,
      "value": 1,
      "guarded": false
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
      "x": 1,
      "y": 10,
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
      "x": 7,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 7,
      "y": 7,
      "breed": "savannah",
      "patrol": 1,
      "facing": 2.69
    },
    {
      "type": "cat",
      "x": 6,
      "y": 1,
      "breed": "bengal",
      "patrol": 2,
      "facing": 1.65
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 10,
      "kind": "extraLife"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 10,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 2,
      "radius": 5.8,
      "intensity": 0.51,
      "flicker": 0.13,
      "on": true
    },
    {
      "x": 7,
      "y": 3,
      "radius": 5.5,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 3,
      "radius": 4.4,
      "intensity": 0.77,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "loop": true,
      "pauseSeconds": 0.61,
      "points": [
        {
          "x": 7,
          "y": 7
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 6,
          "y": 1
        },
        {
          "x": 3,
          "y": 10
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.33,
      "points": [
        {
          "x": 6,
          "y": 1
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 3,
          "y": 10
        },
        {
          "x": 9,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Last Kettle. The vault keeps a second set of books."
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
      "line": "Sneak the vault. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vault. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in moonLab. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. maze heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Last Kettle banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vault keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vault considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 10
      },
      {
        "x": 5,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 5,
        "y": 1
      },
      {
        "x": 5,
        "y": 6
      },
      {
        "x": 9,
        "y": 5
      },
      {
        "x": 11,
        "y": 11
      }
    ],
    "aggression": 0.73,
    "scentBias": 0.73,
    "hearingBias": 0.81,
    "campHoleChance": 0.31,
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
  "parTime": 130,
  "lives": 3,
  "ambient": 0.7,
  "difficulty": 5.9,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "maze",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
