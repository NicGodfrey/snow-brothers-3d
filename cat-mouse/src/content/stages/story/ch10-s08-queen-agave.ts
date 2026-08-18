import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s08-queen-agave",
  "chapter": 10,
  "index": 8,
  "name": "Queen Agave",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 3510191233,
  "width": 18,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "##################",
    "#...............##",
    "#.......#.#.#.#.##",
    "#.......#.#.#.#.##",
    "#.......#.#.###.##",
    "#.........#...#.##",
    "#...........r##.##",
    "#.............#.##",
    "#.............#.##",
    "#.............#.##",
    "#...#####.###.#.##",
    "#...#...#...#.#.##",
    "#.###.#.#.#.###.##",
    "#..............o##",
    "##################"
  ],
  "decor": [
    "   +  +    +      ",
    "   .`,=*+   .`,=  ",
    " =*+   . , *      ",
    "  .`,=*+   . , *  ",
    " *+   .` = +   .  ",
    " .`,=*+    `,= +  ",
    " +   .`,=*+    `  ",
    " `,=*+   .`,=*    ",
    "    .`,=*+   . ,  ",
    " ,=*+   .`,=*+    ",
    "   .       + ` =+ ",
    " =*+   . ,=*      ",
    "     = +   .   *  ",
    " *+   .`,=*+   .  ",
    "          +       "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 13,
      "id": "ch10-s08-queen-agave-hole"
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
      "x": 9,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 1,
      "value": 1,
      "guarded": false
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
      "x": 3,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 9,
      "y": 13,
      "breed": "calico",
      "patrol": 1,
      "facing": 2.16
    },
    {
      "type": "cat",
      "x": 1,
      "y": 8,
      "breed": "scottishFold",
      "patrol": 2,
      "facing": 1.08
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 3,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 7,
      "y": 1,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 6,
      "kind": "water"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 3,
      "kind": "water"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 13,
      "radius": 4.9,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 9,
      "radius": 3.5,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
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
      "pauseSeconds": 0.51,
      "points": [
        {
          "x": 9,
          "y": 13
        },
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 7,
          "y": 1
        },
        {
          "x": 7,
          "y": 3
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.32,
      "points": [
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 7,
          "y": 1
        },
        {
          "x": 7,
          "y": 3
        },
        {
          "x": 12,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Queen Agave. The orchids keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the orchids. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the orchids. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Queen Agave banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The orchids keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the orchids considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 12
      },
      {
        "x": 4,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 4,
        "y": 7
      },
      {
        "x": 9,
        "y": 12
      },
      {
        "x": 11,
        "y": 6
      },
      {
        "x": 1,
        "y": 9
      }
    ],
    "aggression": 1.02,
    "scentBias": 0.44,
    "hearingBias": 0.42,
    "campHoleChance": 0.28,
    "leashRadius": 16
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 8,
      "optional": false,
      "label": "Bank 8 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 8,
  "parTime": 160,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 8.3,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "maze",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
