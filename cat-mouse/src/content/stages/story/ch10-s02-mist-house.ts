import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s02-mist-house",
  "chapter": 10,
  "index": 2,
  "name": "Mist House",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 3369836432,
  "width": 15,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#...##.##.....#",
    "#...#~.~~.#...#",
    "#...#~.~~~#.r.#",
    "#....~.~~~#...#",
    "#...#~.~~~#...#",
    "#...#~.~~~#...#",
    "#...#~.~~~#r..#",
    "#.............#",
    "#...#~.~~~#...#",
    "#.............#",
    "#...##.#.##...#",
    "#.............#",
    "#............o#",
    "###############"
  ],
  "decor": [
    "   +   +  +    ",
    "    .`,=*+   . ",
    " ,=*+   .`,=*+ ",
    "   .  =     .`+",
    " =*+   .`, *+  ",
    "  .` =*+   .`, ",
    " *+   .`,= +   ",
    " .`, *+   +`,= ",
    " +   .`,=*     ",
    " `,= +   . ,=* ",
    "    .`,=*+   . ",
    " ,=*    .` =*+ ",
    "+  .`,=*+   .` ",
    "+=*+    `  *+  ",
    "  .`,=*+   .`, ",
    " *+   .`,=*+   ",
    "            ++ "
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
      "id": "ch10-s02-mist-house-hole"
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 4,
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
      "x": 13,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 2,
      "y": 9,
      "breed": "abyssinian",
      "patrol": 1,
      "facing": 2.76
    },
    {
      "type": "cat",
      "x": 2,
      "y": 15,
      "breed": "sphynx",
      "patrol": 2,
      "facing": 2.39
    },
    {
      "type": "powerUp",
      "x": 10,
      "y": 15,
      "kind": "magnet"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 1,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 7,
      "kind": "water"
    },
    {
      "type": "decorProp",
      "x": 13,
      "y": 14,
      "note": "orchids"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 11,
      "radius": 4.3,
      "intensity": 0.57,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 13,
      "radius": 4.6,
      "intensity": 0.51,
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
      "pauseSeconds": 1.64,
      "points": [
        {
          "x": 2,
          "y": 9
        },
        {
          "x": 13,
          "y": 14
        },
        {
          "x": 10,
          "y": 15
        },
        {
          "x": 2,
          "y": 15
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.31,
      "points": [
        {
          "x": 2,
          "y": 15
        },
        {
          "x": 13,
          "y": 14
        },
        {
          "x": 10,
          "y": 15
        },
        {
          "x": 4,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Mist House. The agave keeps a second set of books."
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
      "line": "Sneak the agave. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the agave. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
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
      "line": "Mist House banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The agave keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the agave considers creaking.",
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
        "x": 6,
        "y": 14
      }
    ],
    "searchSpots": [
      {
        "x": 6,
        "y": 14
      },
      {
        "x": 7,
        "y": 15
      },
      {
        "x": 9,
        "y": 2
      },
      {
        "x": 9,
        "y": 4
      }
    ],
    "aggression": 0.93,
    "scentBias": 0.51,
    "hearingBias": 0.58,
    "campHoleChance": 0.26,
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
  "parTime": 151,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 7.5,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "ring",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
