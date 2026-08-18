import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s02-crate-city",
  "chapter": 9,
  "index": 2,
  "name": "Crate City",
  "theme": "docks",
  "kind": "story",
  "seed": 2248921584,
  "width": 16,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#..............#",
    "#..#####....#..#",
    "#..#~~~~~...#..#",
    "#.....~~~.~.#..#",
    "#..............#",
    "#.L########.#..#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "   +   +        ",
    "  .`,=*+   .`,= ",
    " *+   .`,=*+    ",
    " .`       .`+=*+",
    " +   .`,=*+ + . ",
    " `,=*+   .`, *+ ",
    "    .`,=*+   .` ",
    " ,=        = +  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "                "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 9,
      "id": "ch09-s02-crate-city-hole"
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 2,
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
      "x": 9,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 5,
      "y": 1,
      "breed": "tabby",
      "patrol": 1,
      "facing": 2.42
    },
    {
      "type": "cat",
      "x": 7,
      "y": 8,
      "breed": "norwegianForest",
      "patrol": 2,
      "facing": 2.08
    },
    {
      "type": "powerUp",
      "x": 9,
      "y": 2,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 6,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 6,
      "kind": "fan"
    }
  ],
  "lights": [
    {
      "x": 13,
      "y": 9,
      "radius": 5.1,
      "intensity": 0.51,
      "flicker": 0.23,
      "on": true
    },
    {
      "x": 2,
      "y": 7,
      "radius": 5.4,
      "intensity": 0.65,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 11,
      "y": 5,
      "radius": 3.7,
      "intensity": 0.87,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 14,
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
      "loop": false,
      "pauseSeconds": 0.97,
      "points": [
        {
          "x": 5,
          "y": 1
        },
        {
          "x": 13,
          "y": 9
        },
        {
          "x": 7,
          "y": 8
        },
        {
          "x": 9,
          "y": 2
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.45,
      "points": [
        {
          "x": 7,
          "y": 8
        },
        {
          "x": 13,
          "y": 9
        },
        {
          "x": 9,
          "y": 2
        },
        {
          "x": 11,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Crate City. The nets keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the nets. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the nets. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Crate City banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The nets keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the nets considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 8
      },
      {
        "x": 13,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 13,
        "y": 2
      },
      {
        "x": 13,
        "y": 6
      },
      {
        "x": 9,
        "y": 5
      },
      {
        "x": 2,
        "y": 2
      }
    ],
    "aggression": 0.95,
    "scentBias": 0.4,
    "hearingBias": 0.55,
    "campHoleChance": 0.21,
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
  "parTime": 143,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 6.8,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "ring",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
