import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s03-bell-loft",
  "chapter": 11,
  "index": 3,
  "name": "Bell Loft",
  "theme": "clocktower",
  "kind": "story",
  "seed": 996888597,
  "width": 21,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#...................#",
    "#...................#",
    "#..###########.r##..#",
    "#..###############..#",
    "#..###############..#",
    "#..###############..#",
    "#..###############..#",
    "#..###############..#",
    "#..###############..#",
    "#..###############..#",
    "#....#############..#",
    "#..........s........#",
    "#....D.............o#",
    "#####################"
  ],
  "decor": [
    "   +                +",
    " ,=*+   .`,=*+   .`, ",
    "   .`,=*+   .`,=*+   ",
    " =*+   .`,=*+   .`,= ",
    "  .           =*     ",
    " *+ +             =* ",
    " .`                . ",
    " +             +  *+ ",
    " `,           +   .` ",
    "                  +  ",
    " ,=        +      `, ",
    "          +          ",
    " =*+    +         ,= ",
    "  .`,=*+   .`,=*+    ",
    " *+   .`,=*+   .`,=* ",
    "                     "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 14,
      "id": "ch11-s03-bell-loft-hole"
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 1,
      "value": 1,
      "guarded": true
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
      "x": 2,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 3,
      "y": 14,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 0.06
    },
    {
      "type": "cat",
      "x": 2,
      "y": 8,
      "breed": "manx",
      "patrol": 2,
      "facing": 3.26
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 13,
      "kind": "freeze"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 14,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 2,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 6,
      "y": 14,
      "keyId": "ch11-s03-bell-loft-key"
    },
    {
      "type": "door",
      "x": 5,
      "y": 14,
      "id": "ch11-s03-bell-loft-door",
      "locked": true,
      "keyId": "ch11-s03-bell-loft-key"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 6,
      "radius": 5.9,
      "intensity": 0.55,
      "flicker": 0.23,
      "on": true
    },
    {
      "x": 7,
      "y": 1,
      "radius": 5,
      "intensity": 0.59,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "pauseSeconds": 0.42,
      "points": [
        {
          "x": 3,
          "y": 14
        },
        {
          "x": 2,
          "y": 8
        },
        {
          "x": 7,
          "y": 13
        },
        {
          "x": 9,
          "y": 14
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.09,
      "points": [
        {
          "x": 2,
          "y": 8
        },
        {
          "x": 7,
          "y": 13
        },
        {
          "x": 9,
          "y": 14
        },
        {
          "x": 13,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Bell Loft. The bell keeps a second set of books."
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
      "line": "Sneak the bell. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the bell. Heavy. Mine until the hole says otherwise."
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
      "line": "Bell Loft banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The bell keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the bell considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 13
      },
      {
        "x": 12,
        "y": 14
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 14
      },
      {
        "x": 17,
        "y": 3
      },
      {
        "x": 8,
        "y": 1
      },
      {
        "x": 12,
        "y": 1
      }
    ],
    "aggression": 1.01,
    "scentBias": 0.82,
    "hearingBias": 0.68,
    "campHoleChance": 0.18,
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
  "parTime": 167,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.4,
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
