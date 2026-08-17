import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s05-irrigation",
  "chapter": 10,
  "index": 5,
  "name": "Irrigation",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 727507172,
  "width": 20,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#..................#",
    "#..G...X...X...G...#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#.#...########.#####",
    "#..................#",
    "#...T..r.G.........#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#.................o#",
    "####################"
  ],
  "decor": [
    "    +  +            ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`, *+   .` ",
    "   .`,=*+   .`,=*+  ",
    " =*+   .`,=*+   .`, ",
    "  .`,=*+   .`,=*+   ",
    " *                  ",
    " .`,=*+   .`,=*+   +",
    " +  =.`,=*+   .`,=* ",
    " `,=*+   .`,=*+   . ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .` ",
    "   .`,=*+   .`,=*+  ",
    "       + ++         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 12,
      "id": "ch10-s05-irrigation-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 5,
      "value": 1,
      "guarded": false
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
      "x": 13,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 1,
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
      "x": 17,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 16,
      "y": 5,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 4.1
    },
    {
      "type": "cat",
      "x": 11,
      "y": 7,
      "breed": "abyssinian",
      "patrol": 2,
      "facing": 1.76
    },
    {
      "type": "powerUp",
      "x": 5,
      "y": 4,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 12,
      "kind": "water"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 1,
      "radius": 5.7,
      "intensity": 0.79,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
      "y": 1,
      "radius": 4.5,
      "intensity": 0.46,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 10,
      "y": 4,
      "radius": 4.8,
      "intensity": 0.53,
      "flicker": 0.22,
      "on": true
    },
    {
      "x": 18,
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
      "pauseSeconds": 0.72,
      "points": [
        {
          "x": 16,
          "y": 5
        },
        {
          "x": 11,
          "y": 7
        },
        {
          "x": 13,
          "y": 12
        },
        {
          "x": 5,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.87,
      "points": [
        {
          "x": 11,
          "y": 7
        },
        {
          "x": 13,
          "y": 12
        },
        {
          "x": 5,
          "y": 4
        },
        {
          "x": 7,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Irrigation. The seedlings keeps a second set of books."
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
      "line": "Sneak the seedlings. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the seedlings. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
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
      "line": "Irrigation banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The seedlings keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the seedlings considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 18,
        "y": 11
      },
      {
        "x": 9,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 3
      },
      {
        "x": 17,
        "y": 5
      },
      {
        "x": 14,
        "y": 12
      },
      {
        "x": 13,
        "y": 5
      }
    ],
    "aggression": 1,
    "scentBias": 0.44,
    "hearingBias": 0.65,
    "campHoleChance": 0.29,
    "leashRadius": 16
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
  "parTime": 153,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 7.9,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "galleries",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
