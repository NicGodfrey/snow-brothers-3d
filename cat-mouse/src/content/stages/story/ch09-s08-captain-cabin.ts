import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s08-captain-cabin",
  "chapter": 9,
  "index": 8,
  "name": "Captain Cabin",
  "theme": "docks",
  "kind": "story",
  "seed": 2292627261,
  "width": 23,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.....................#",
    "#.....................#",
    "#.#####.#.#..########.#",
    "#.....................#",
    "#...L....L....L....X..#",
    "#.....................#",
    "#.#.###.###.#########.#",
    "#.....................#",
    "#....p...X...p...X....#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "                     + ",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,       ` =*        * ",
    "   .`,=*+   .`,=*+   . ",
    " =*+   .`,=*+   .`, *+ ",
    "  .`,=*+   .`,=*+   .`+",
    " *    +`   +           ",
    " .`,=*+   .`,=*+   .`, ",
    " +   .`,= +   .`, *+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,=*+   .`,=*+   .`,=* ",
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
      "y": 13,
      "id": "ch09-s08-captain-cabin-hole"
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 21,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 15,
      "y": 7,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 2.65
    },
    {
      "type": "cat",
      "x": 10,
      "y": 7,
      "breed": "sphynx",
      "patrol": 2,
      "facing": 1.36
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 2,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 5,
      "y": 13,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 16,
      "y": 7,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 6,
      "y": 6,
      "note": "cold storage"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 7,
      "radius": 3.7,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 1,
      "radius": 5.8,
      "intensity": 0.68,
      "flicker": 0.16,
      "on": true
    },
    {
      "x": 2,
      "y": 12,
      "radius": 4.8,
      "intensity": 0.82,
      "flicker": 0.16,
      "on": true
    },
    {
      "x": 21,
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
      "pauseSeconds": 0.59,
      "points": [
        {
          "x": 15,
          "y": 7
        },
        {
          "x": 10,
          "y": 7
        },
        {
          "x": 8,
          "y": 2
        },
        {
          "x": 5,
          "y": 13
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.35,
      "points": [
        {
          "x": 10,
          "y": 7
        },
        {
          "x": 8,
          "y": 2
        },
        {
          "x": 5,
          "y": 13
        },
        {
          "x": 16,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Captain Cabin. The cold storage keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the cold storage. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the cold storage. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Captain Cabin banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The cold storage keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the cold storage considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 12
      },
      {
        "x": 19,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 19,
        "y": 11
      },
      {
        "x": 14,
        "y": 7
      },
      {
        "x": 5,
        "y": 7
      },
      {
        "x": 7,
        "y": 11
      }
    ],
    "aggression": 0.95,
    "scentBias": 0.77,
    "hearingBias": 0.5,
    "campHoleChance": 0.22,
    "leashRadius": 15
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
  "parTime": 168,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 7.6,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "galleries",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
