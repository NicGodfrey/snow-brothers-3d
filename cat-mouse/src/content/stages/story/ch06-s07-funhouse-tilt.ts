import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s07-funhouse-tilt",
  "chapter": 6,
  "index": 7,
  "name": "Funhouse Tilt",
  "theme": "carnival",
  "kind": "story",
  "seed": 2407597876,
  "width": 22,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "######################",
    "#....................#",
    "#...........XXXX.....#",
    "#....................#",
    "#.XXX...r...TTT..r...#",
    "#.XGG..TT...TTT......#",
    "#.XGG..TT.....GGGGGr.#",
    "#..GG..TT...GGGGGGG..#",
    "#......TT...GGGGGGG..#",
    "#.r.XXX.....GGGG.....#",
    "#....................#",
    "#....................#",
    "#...................o#",
    "######################"
  ],
  "decor": [
    "                      ",
    "   .`,=*+   .`,=*+    ",
    " =*+   .`,=* =  .`,=*+",
    "  .`,=*+   .`,=*+   . ",
    " *    .`,=*+=  .`,=*+ ",
    " . ,=*+== .`   +   .` ",
    " +   .` =*+   .`,=*+  ",
    " `,=*+  =.`,=*+   .`, ",
    "    .`,  +   .`,=*+   ",
    " ,=*    .`,=*+   .`,= ",
    "   .`,=*+   .`,=*+    ",
    " =*+   .`,=*+   .`,=* ",
    "  .`,=*+   .`,=*+   . ",
    "                      "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 20,
      "y": 12,
      "id": "ch06-s07-funhouse-tilt-hole"
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
      "x": 15,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 1,
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
      "x": 13,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 13,
      "y": 6,
      "breed": "siamese",
      "patrol": 1,
      "facing": 0.05
    },
    {
      "type": "powerUp",
      "x": 16,
      "y": 7,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 17,
      "y": 6,
      "kind": "broom"
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 7,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 3,
      "note": "prize tent"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 10,
      "radius": 3.3,
      "intensity": 0.52,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 6,
      "radius": 6.1,
      "intensity": 0.48,
      "flicker": 0.31,
      "on": true
    },
    {
      "x": 5,
      "y": 5,
      "radius": 5,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 20,
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
      "pauseSeconds": 1.51,
      "points": [
        {
          "x": 13,
          "y": 6
        },
        {
          "x": 16,
          "y": 7
        },
        {
          "x": 1,
          "y": 3
        },
        {
          "x": 17,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Funhouse Tilt. The mirrors keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the mirrors. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the mirrors. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Funhouse Tilt banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The mirrors keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the mirrors considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 20,
        "y": 11
      },
      {
        "x": 1,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 6
      },
      {
        "x": 15,
        "y": 10
      },
      {
        "x": 9,
        "y": 1
      },
      {
        "x": 12,
        "y": 1
      }
    ],
    "aggression": 0.71,
    "scentBias": 0.61,
    "hearingBias": 0.4,
    "campHoleChance": 0.16,
    "leashRadius": 12
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 6,
      "optional": false,
      "label": "Bank 6 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 6,
  "parTime": 141,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 5.3,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "islands",
    "story",
    "solo-cat",
    "q6"
  ]
};

export default stage;
