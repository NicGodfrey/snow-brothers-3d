import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s02-pendulum-well",
  "chapter": 11,
  "index": 2,
  "name": "Pendulum Well",
  "theme": "clocktower",
  "kind": "story",
  "seed": 1856488471,
  "width": 20,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#..................#",
    "#...............s..#",
    "#...........s......#",
    "#......LLL.........#",
    "#......LLL.........#",
    "#..................#",
    "#..sLL.....LLLL....#",
    "#...LLg............#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#.................o#",
    "####################"
  ],
  "decor": [
    "                    ",
    " `,=*+   .`,=*+   . ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .` ",
    "   .`,=*+   .`,=*+  ",
    " =*+   .`,=*+   .`, ",
    "+ .`,=*+   .`,=*+   ",
    " *+   .`,=*+   .`,= ",
    " .`,=*+   .`,=*+    ",
    " +   .`,=*+   .`,=* ",
    " `,=*+   .`,=*+   . ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .` ",
    "   .`,=*+   .`,=*+  ",
    "                    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 13,
      "id": "ch11-s02-pendulum-well-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 9,
      "value": 1,
      "guarded": true
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
      "x": 8,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 3,
      "y": 10,
      "breed": "russianBlue",
      "patrol": 1,
      "facing": 1.42
    },
    {
      "type": "cat",
      "x": 1,
      "y": 8,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 2.1
    },
    {
      "type": "powerUp",
      "x": 17,
      "y": 3,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 1,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 1,
      "kind": "sparkWire"
    },
    {
      "type": "decorProp",
      "x": 17,
      "y": 13,
      "note": "escapement"
    }
  ],
  "lights": [
    {
      "x": 6,
      "y": 12,
      "radius": 5.4,
      "intensity": 0.46,
      "flicker": 0.31,
      "on": true
    },
    {
      "x": 17,
      "y": 2,
      "radius": 5.4,
      "intensity": 0.78,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 4,
      "radius": 5.3,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
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
      "loop": false,
      "pauseSeconds": 1.3,
      "points": [
        {
          "x": 3,
          "y": 10
        },
        {
          "x": 17,
          "y": 13
        },
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 17,
          "y": 3
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.41,
      "points": [
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 17,
          "y": 13
        },
        {
          "x": 17,
          "y": 3
        },
        {
          "x": 9,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Pendulum Well. The gears keeps a second set of books."
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
      "line": "Sneak the gears. Dash is postage. The islands layout lies about shortcuts.",
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
      "line": "Half of 8. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Pendulum Well banked. Whiskers attached."
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
        "x": 18,
        "y": 12
      },
      {
        "x": 2,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 4
      },
      {
        "x": 17,
        "y": 10
      },
      {
        "x": 15,
        "y": 9
      },
      {
        "x": 14,
        "y": 12
      }
    ],
    "aggression": 1.05,
    "scentBias": 0.78,
    "hearingBias": 0.84,
    "campHoleChance": 0.31,
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
  "parTime": 163,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.2,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "islands",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
