import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s01-pier-planks",
  "chapter": 9,
  "index": 1,
  "name": "Pier Planks",
  "theme": "docks",
  "kind": "story",
  "seed": 2974440651,
  "width": 22,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "######################",
    "#....................#",
    "#....................#",
    "#.....LXXXL..........#",
    "#.....LXXXLL..LLL....#",
    "#......XXXLL.LLLL....#",
    "#....XXXXX...LDL.....#",
    "#....................#",
    "#.pp.................#",
    "#.pp...ppppLp........#",
    "#.pp...pppp..........#",
    "#.L..................#",
    "#....................#",
    "#...................o#",
    "######################"
  ],
  "decor": [
    "   +            +     ",
    "+,=*+   .`,=*+   .`,= ",
    "   .`,=*+   .`,=*+    ",
    " =*+   ====*+   .`,=* ",
    "+ .`,=*=   .`,=*+   . ",
    " *+   .=  *+   .`,=*+ ",
    " .`,=   = .`,==+   .` ",
    " +   .`,=*+   .`,=*+  ",
    " `,=*+   .`,=*+   .`, ",
    "    .`,=*+   .`,=*+  +",
    "+,=*+   .`,=*+   .`,= ",
    "   .`,=*+   .`,=*+    ",
    " =*+   .`,=*+   .`,=* ",
    "+ .`,=*+   .`,=*+   . ",
    "                   +  "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 20,
      "y": 13,
      "id": "ch09-s01-pier-planks-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 13,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 5,
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
      "x": 5,
      "y": 8,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 4.36
    },
    {
      "type": "cat",
      "x": 18,
      "y": 6,
      "breed": "tabby",
      "patrol": 2,
      "facing": 6.26
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 10,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 2,
      "kind": "glueBoard"
    },
    {
      "type": "key",
      "x": 7,
      "y": 10,
      "keyId": "ch09-s01-pier-planks-key"
    },
    {
      "type": "door",
      "x": 14,
      "y": 6,
      "id": "ch09-s01-pier-planks-door",
      "locked": true,
      "keyId": "ch09-s01-pier-planks-key"
    }
  ],
  "lights": [
    {
      "x": 15,
      "y": 3,
      "radius": 5,
      "intensity": 0.7,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
      "y": 9,
      "radius": 3.8,
      "intensity": 0.89,
      "flicker": 0.26,
      "on": true
    },
    {
      "x": 1,
      "y": 3,
      "radius": 5.9,
      "intensity": 0.63,
      "flicker": 0,
      "on": true
    },
    {
      "x": 20,
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
      "pauseSeconds": 0.5,
      "points": [
        {
          "x": 5,
          "y": 8
        },
        {
          "x": 3,
          "y": 2
        },
        {
          "x": 18,
          "y": 6
        },
        {
          "x": 13,
          "y": 10
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.3,
      "points": [
        {
          "x": 18,
          "y": 6
        },
        {
          "x": 3,
          "y": 2
        },
        {
          "x": 13,
          "y": 10
        },
        {
          "x": 7,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Pier Planks. The nets keeps a second set of books."
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
      "line": "Sneak the nets. Dash is postage. The islands layout lies about shortcuts.",
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
      "line": "Pier Planks banked. Whiskers attached."
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
        "x": 20,
        "y": 12
      },
      {
        "x": 9,
        "y": 13
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 13
      },
      {
        "x": 12,
        "y": 6
      },
      {
        "x": 7,
        "y": 13
      },
      {
        "x": 3,
        "y": 13
      }
    ],
    "aggression": 0.98,
    "scentBias": 0.38,
    "hearingBias": 0.73,
    "campHoleChance": 0.29,
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
  "parTime": 158,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 6.7,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "islands",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
