import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-12-alley-overflow",
  "chapter": 0,
  "index": 12,
  "name": "Alley Overflow",
  "theme": "moonLab",
  "kind": "arcade",
  "seed": 4001462396,
  "width": 16,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#....vvv.......#",
    "#...vvvv.......#",
    "#...vvvv..GG...#",
    "#....vvv.......#",
    "#.D.Dvvv.......#",
    "#.D.Dvvv.......#",
    "#..............#",
    "#......GGGGG...#",
    "#......GGGGG...#",
    "#......GGGGG...#",
    "#......GGGGGG..#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "              + ",
    " .`,=*+   .`,=* ",
    " +   .`,=*+   . ",
    " `,=*+   .`,=*+ ",
    "    .`,=*+   .`+",
    " ,=*+   .`,=*+ +",
    "  =. ,=*+   .`, ",
    " = +   .`,=*+   ",
    "+ .`,=*+   .`,= ",
    " *+   .`,=*+    ",
    " .`,=*+   .`,=* ",
    " +   .`,=*+   . ",
    " `,=*+   .`,=*+ ",
    "    .`,=*+   .` ",
    " ,=*+   .`,=*+  ",
    "+               "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 14,
      "id": "arcade-12-alley-overflow-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 2,
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
      "x": 3,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 8,
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
      "x": 4,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 10,
      "y": 14,
      "breed": "savannah",
      "patrol": 1,
      "facing": 2.16
    },
    {
      "type": "cat",
      "x": 13,
      "y": 11,
      "breed": "bengal",
      "patrol": 2,
      "facing": 2.91
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 7,
      "kind": "freeze"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 3,
      "kind": "vacuum"
    },
    {
      "type": "decorProp",
      "x": 4,
      "y": 1,
      "note": "cryo"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 2,
      "radius": 5.6,
      "intensity": 0.8,
      "flicker": 0.12,
      "on": true
    },
    {
      "x": 12,
      "y": 2,
      "radius": 4.9,
      "intensity": 0.55,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 10,
      "radius": 5,
      "intensity": 0.82,
      "flicker": 0.22,
      "on": true
    },
    {
      "x": 4,
      "y": 11,
      "radius": 4.3,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 14,
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
      "pauseSeconds": 0.47,
      "points": [
        {
          "x": 10,
          "y": 14
        },
        {
          "x": 13,
          "y": 11
        },
        {
          "x": 12,
          "y": 7
        },
        {
          "x": 9,
          "y": 3
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.29,
      "points": [
        {
          "x": 13,
          "y": 11
        },
        {
          "x": 12,
          "y": 7
        },
        {
          "x": 9,
          "y": 3
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
      "line": "Alley Overflow. The cryo keeps a second set of books."
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
      "line": "Sneak the cryo. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the cryo. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in moonLab. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. islands heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Alley Overflow banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The cryo keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the cryo considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 13
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
        "x": 3,
        "y": 2
      },
      {
        "x": 8,
        "y": 1
      },
      {
        "x": 3,
        "y": 10
      }
    ],
    "aggression": 0.69,
    "scentBias": 0.58,
    "hearingBias": 0.56,
    "campHoleChance": 0.28,
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
  "parTime": 135,
  "lives": 3,
  "ambient": 0.7,
  "difficulty": 4.4,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "islands",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
