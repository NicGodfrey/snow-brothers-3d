import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s05-warehouse-aisle",
  "chapter": 9,
  "index": 5,
  "name": "Warehouse Aisle",
  "theme": "docks",
  "kind": "story",
  "seed": 203101279,
  "width": 24,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#..L...L...X.......X...#",
    "#......................#",
    "#.##.########.#.########",
    "#......................#",
    "#......................#",
    "#......................#",
    "#......................#",
    "#.....................o#",
    "########################"
  ],
  "decor": [
    "                        ",
    " `,=*+   .`,=*+   .`,=* ",
    "    .`,=*+   .`,=*+   . ",
    "+,=*+   .`,=*+   .`,=*+ ",
    "    `        ` =  +     ",
    " =*+   .`,=*+   .`,=*+  ",
    "  .`,=*+   .`,=*+   .`, ",
    " *+   .`,=*+   .`,=*+   ",
    "+.`,=*+   .`,=*+   .`,= ",
    " +   .`,=*+   .`,=*+    ",
    "                 +      "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 9,
      "id": "ch09-s05-warehouse-aisle-hole"
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
      "x": 21,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 3,
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
      "x": 15,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 6,
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
      "x": 14,
      "y": 1,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 0.64
    },
    {
      "type": "cat",
      "x": 3,
      "y": 8,
      "breed": "tabby",
      "patrol": 2,
      "facing": 3.37
    },
    {
      "type": "powerUp",
      "x": 20,
      "y": 2,
      "kind": "magnet"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 9,
      "kind": "fan"
    }
  ],
  "lights": [
    {
      "x": 5,
      "y": 1,
      "radius": 4.4,
      "intensity": 0.51,
      "flicker": 0.29,
      "on": true
    },
    {
      "x": 11,
      "y": 5,
      "radius": 5.9,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
      "y": 9,
      "radius": 5.5,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 9,
      "radius": 5.2,
      "intensity": 0.75,
      "flicker": 0,
      "on": true
    },
    {
      "x": 22,
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
      "pauseSeconds": 1.6,
      "points": [
        {
          "x": 14,
          "y": 1
        },
        {
          "x": 3,
          "y": 8
        },
        {
          "x": 20,
          "y": 2
        },
        {
          "x": 12,
          "y": 9
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.4,
      "points": [
        {
          "x": 3,
          "y": 8
        },
        {
          "x": 20,
          "y": 2
        },
        {
          "x": 12,
          "y": 9
        },
        {
          "x": 5,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Warehouse Aisle. The pier keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the pier. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pier. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Warehouse Aisle banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pier keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pier considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 8
      },
      {
        "x": 15,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 15,
        "y": 1
      },
      {
        "x": 21,
        "y": 6
      },
      {
        "x": 18,
        "y": 3
      },
      {
        "x": 4,
        "y": 1
      }
    ],
    "aggression": 0.96,
    "scentBias": 0.42,
    "hearingBias": 0.38,
    "campHoleChance": 0.28,
    "leashRadius": 15
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 7,
      "optional": false,
      "label": "Bank 7 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 7,
  "parTime": 151,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 7.2,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "galleries",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
