import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s05-winding-stair",
  "chapter": 11,
  "index": 5,
  "name": "Winding Stair",
  "theme": "clocktower",
  "kind": "story",
  "seed": 801428648,
  "width": 15,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#.............#",
    "#..###.#.###..#",
    "#.............#",
    "#..###.#####..#",
    "#..###.#####..#",
    "#..###.#####..#",
    "#..###.#####..#",
    "#..###.#####..#",
    "#..###.####.g.#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#............o#",
    "###############"
  ],
  "decor": [
    " ++  +         ",
    " =*+   .`,=*+  ",
    "  .`,=*+   .`, ",
    " *+   .`,=*+   ",
    " .` + +     ,= ",
    "++   .`,=*+    ",
    " `,         =* ",
    "      ,      . ",
    " ,=     +   *+ ",
    "      =     .` ",
    " =*         +  ",
    "  .   *    .`, ",
    " *+   .`,=*+   ",
    " .`,=*+   .`,= ",
    " +   .`,=*+    ",
    " `,=*+   .`,=* ",
    "          +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 15,
      "id": "ch11-s05-winding-stair-hole"
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 12,
      "value": 1,
      "guarded": false
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
      "x": 6,
      "y": 13,
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
      "x": 8,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 13,
      "y": 5,
      "breed": "savannah",
      "patrol": 1,
      "facing": 2.73
    },
    {
      "type": "cat",
      "x": 7,
      "y": 2,
      "breed": "russianBlue",
      "patrol": 2,
      "facing": 3.76
    },
    {
      "type": "powerUp",
      "x": 1,
      "y": 5,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 6,
      "y": 3,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 6,
      "kind": "snapTrap"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 15,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 13,
      "y": 14,
      "note": "pendulum"
    }
  ],
  "lights": [
    {
      "x": 12,
      "y": 15,
      "radius": 3.9,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 13,
      "radius": 3.6,
      "intensity": 0.54,
      "flicker": 0.11,
      "on": true
    },
    {
      "x": 6,
      "y": 1,
      "radius": 4.3,
      "intensity": 0.45,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 1.54,
      "points": [
        {
          "x": 13,
          "y": 5
        },
        {
          "x": 13,
          "y": 14
        },
        {
          "x": 12,
          "y": 15
        },
        {
          "x": 7,
          "y": 2
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.11,
      "points": [
        {
          "x": 7,
          "y": 2
        },
        {
          "x": 13,
          "y": 14
        },
        {
          "x": 12,
          "y": 15
        },
        {
          "x": 6,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Winding Stair. The gears keeps a second set of books."
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
      "line": "Sneak the gears. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the gears. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Winding Stair banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The gears keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the gears considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 14
      },
      {
        "x": 8,
        "y": 13
      }
    ],
    "searchSpots": [
      {
        "x": 8,
        "y": 13
      },
      {
        "x": 7,
        "y": 3
      },
      {
        "x": 12,
        "y": 5
      },
      {
        "x": 13,
        "y": 12
      }
    ],
    "aggression": 1.1,
    "scentBias": 0.58,
    "hearingBias": 0.38,
    "campHoleChance": 0.23,
    "leashRadius": 17
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
  "parTime": 159,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.6,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "ring",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
