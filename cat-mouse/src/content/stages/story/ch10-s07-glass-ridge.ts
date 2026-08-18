import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s07-glass-ridge",
  "chapter": 10,
  "index": 7,
  "name": "Glass Ridge",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 2667588728,
  "width": 23,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.....................#",
    "#.....................#",
    "#....GGGG..XXXX.......#",
    "#.....GGGG.XXXX...r...#",
    "#....GGGGG.XXXX.......#",
    "#....XXXX..TTTT.T.....#",
    "#....XXXTTTTTTT.T.....#",
    "#.....................#",
    "#.....................#",
    "#...................G.#",
    "#...............D....o#",
    "#######################"
  ],
  "decor": [
    "  +                +   ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   .`,=*+ +",
    " .`,=*+   .    +   .`, ",
    " +   .`,=*+    `,=*+   ",
    " `,=*+   .`       .`,= ",
    "    .   =+     , *+    ",
    "+,=*+  ===      =.`,=* ",
    "   .`,=*+   .`,=*+   . ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   . ,=*+  ",
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
      "y": 12,
      "id": "ch10-s07-glass-ridge-hole"
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 9,
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
      "x": 15,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 3,
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
      "x": 5,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 21,
      "y": 10,
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
      "type": "cat",
      "x": 17,
      "y": 4,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 3.85
    },
    {
      "type": "cat",
      "x": 10,
      "y": 3,
      "breed": "calico",
      "patrol": 2,
      "facing": 2.21
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 6,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 20,
      "y": 6,
      "kind": "water"
    },
    {
      "type": "hazard",
      "x": 18,
      "y": 1,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 12,
      "kind": "glueBoard"
    },
    {
      "type": "key",
      "x": 16,
      "y": 3,
      "keyId": "ch10-s07-glass-ridge-key"
    },
    {
      "type": "door",
      "x": 16,
      "y": 12,
      "id": "ch10-s07-glass-ridge-door",
      "locked": true,
      "keyId": "ch10-s07-glass-ridge-key"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 2,
      "radius": 4.7,
      "intensity": 0.65,
      "flicker": 0.29,
      "on": true
    },
    {
      "x": 2,
      "y": 12,
      "radius": 5.6,
      "intensity": 0.46,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
      "y": 10,
      "radius": 5.2,
      "intensity": 0.76,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
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
      "loop": false,
      "pauseSeconds": 1.28,
      "points": [
        {
          "x": 17,
          "y": 4
        },
        {
          "x": 10,
          "y": 3
        },
        {
          "x": 3,
          "y": 6
        },
        {
          "x": 20,
          "y": 6
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.64,
      "points": [
        {
          "x": 10,
          "y": 3
        },
        {
          "x": 3,
          "y": 6
        },
        {
          "x": 20,
          "y": 6
        },
        {
          "x": 18,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Glass Ridge. The mist keeps a second set of books."
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
      "line": "Sneak the mist. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the mist. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
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
      "line": "Glass Ridge banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The mist keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the mist considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 11
      },
      {
        "x": 20,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 20,
        "y": 9
      },
      {
        "x": 17,
        "y": 5
      },
      {
        "x": 15,
        "y": 10
      },
      {
        "x": 19,
        "y": 3
      }
    ],
    "aggression": 0.98,
    "scentBias": 0.77,
    "hearingBias": 0.77,
    "campHoleChance": 0.23,
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
  "parTime": 165,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 8.1,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "islands",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
