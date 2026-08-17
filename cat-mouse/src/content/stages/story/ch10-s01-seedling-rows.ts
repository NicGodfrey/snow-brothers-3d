import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s01-seedling-rows",
  "chapter": 10,
  "index": 1,
  "name": "Seedling Rows",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 79171719,
  "width": 23,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.....GGGGGGGG........#",
    "#.....................#",
    "#.....GGGGGGGG........#",
    "#....XGGGG.XXG........#",
    "#....XXXGG.XXG........#",
    "#.....................#",
    "#.....................#",
    "#D......GGGGG.....rG..#",
    "#.....................#",
    "#........TTT..........#",
    "#........TTT.......r..#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "   +                   ",
    " ,=*+   .`,=*+   .`,=* ",
    "   .`,=*+   .`,=*+   . ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*=   .`,=*+  ",
    "+.`,==    . ==*+   .`, ",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,=*+   .`,=*+   .`,=* ",
    "   .`,=*+  =.`,=*+   . ",
    " =*+   .`   +   .`,=*+ ",
    "  .`,=*+   .`,=*+   .`+",
    " *+   .`,=*+   .`,=*+  ",
    " .`,=*+   .`,=*+   .`, ",
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
      "y": 15,
      "id": "ch10-s01-seedling-rows-hole"
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 21,
      "y": 13,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 8,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 14,
      "y": 4,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 5.9
    },
    {
      "type": "cat",
      "x": 9,
      "y": 5,
      "breed": "abyssinian",
      "patrol": 2,
      "facing": 3.88
    },
    {
      "type": "powerUp",
      "x": 16,
      "y": 15,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 11,
      "kind": "water"
    },
    {
      "type": "hazard",
      "x": 19,
      "y": 3,
      "kind": "water"
    },
    {
      "type": "hazard",
      "x": 19,
      "y": 4,
      "kind": "water"
    },
    {
      "type": "key",
      "x": 20,
      "y": 11,
      "keyId": "ch10-s01-seedling-rows-key"
    },
    {
      "type": "door",
      "x": 1,
      "y": 9,
      "id": "ch10-s01-seedling-rows-door",
      "locked": true,
      "keyId": "ch10-s01-seedling-rows-key"
    },
    {
      "type": "decorProp",
      "x": 21,
      "y": 8,
      "note": "seedlings"
    }
  ],
  "lights": [
    {
      "x": 16,
      "y": 6,
      "radius": 5.6,
      "intensity": 0.68,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 8,
      "radius": 4.7,
      "intensity": 0.56,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 3,
      "radius": 5.2,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
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
      "pauseSeconds": 1.08,
      "points": [
        {
          "x": 14,
          "y": 4
        },
        {
          "x": 9,
          "y": 5
        },
        {
          "x": 16,
          "y": 15
        },
        {
          "x": 15,
          "y": 11
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.83,
      "points": [
        {
          "x": 9,
          "y": 5
        },
        {
          "x": 16,
          "y": 15
        },
        {
          "x": 15,
          "y": 11
        },
        {
          "x": 19,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Seedling Rows. The orchids keeps a second set of books."
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
      "line": "Sneak the orchids. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the orchids. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Seedling Rows banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The orchids keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the orchids considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 14
      },
      {
        "x": 10,
        "y": 10
      }
    ],
    "searchSpots": [
      {
        "x": 10,
        "y": 10
      },
      {
        "x": 20,
        "y": 8
      },
      {
        "x": 5,
        "y": 11
      },
      {
        "x": 16,
        "y": 7
      }
    ],
    "aggression": 0.97,
    "scentBias": 0.71,
    "hearingBias": 0.75,
    "campHoleChance": 0.18,
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
  "parTime": 164,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 7.4,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "islands",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
