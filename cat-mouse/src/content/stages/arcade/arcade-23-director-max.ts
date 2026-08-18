import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-23-director-max",
  "chapter": 0,
  "index": 23,
  "name": "Director Max",
  "theme": "clocktower",
  "kind": "arcade",
  "seed": 2674195346,
  "width": 16,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#..p.......g...#",
    "#..............#",
    "#..............#",
    "#.#######..#.###",
    "#..............#",
    "#...p..........#",
    "#..............#",
    "#..............#",
    "#.#########..###",
    "#..............#",
    "#....L...p.....#",
    "#..............#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "      +         ",
    "    .`,=*+   .` ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "            `  +",
    " *+   .`,=*+    ",
    " .`,=*+   .`,=* ",
    " +   .`,=*+   . ",
    " `,=*+   .`,=*+ ",
    "                ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "+ .`,=*+   .`,= ",
    " *+   .`,=*+    ",
    "        +       "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 15,
      "id": "arcade-23-director-max-hole"
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 7,
      "value": 1,
      "guarded": false
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
      "x": 5,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 12,
      "y": 7,
      "breed": "manx",
      "patrol": 1,
      "facing": 1.15
    },
    {
      "type": "cat",
      "x": 12,
      "y": 11,
      "breed": "savannah",
      "patrol": 2,
      "facing": 0.78
    },
    {
      "type": "powerUp",
      "x": 1,
      "y": 3,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 1,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 3,
      "y": 13,
      "note": "gears"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 14,
      "radius": 6.1,
      "intensity": 0.55,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 7,
      "radius": 4.5,
      "intensity": 0.6,
      "flicker": 0.24,
      "on": true
    },
    {
      "x": 14,
      "y": 15,
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
      "pauseSeconds": 0.37,
      "points": [
        {
          "x": 12,
          "y": 7
        },
        {
          "x": 1,
          "y": 3
        },
        {
          "x": 12,
          "y": 11
        },
        {
          "x": 11,
          "y": 1
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.22,
      "points": [
        {
          "x": 12,
          "y": 11
        },
        {
          "x": 1,
          "y": 3
        },
        {
          "x": 11,
          "y": 1
        },
        {
          "x": 3,
          "y": 13
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Director Max. The bell keeps a second set of books."
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
      "line": "Sneak the bell. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the bell. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. galleries heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Director Max banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The bell keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the bell considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 14
      },
      {
        "x": 12,
        "y": 14
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 14
      },
      {
        "x": 1,
        "y": 12
      },
      {
        "x": 13,
        "y": 4
      },
      {
        "x": 8,
        "y": 2
      }
    ],
    "aggression": 0.75,
    "scentBias": 0.75,
    "hearingBias": 0.37,
    "campHoleChance": 0.23,
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
  "parTime": 136,
  "lives": 3,
  "ambient": 0.38,
  "difficulty": 5.8,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "galleries",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
