import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s02-armor-hall",
  "chapter": 7,
  "index": 2,
  "name": "Armor Hall",
  "theme": "museum",
  "kind": "story",
  "seed": 2698852652,
  "width": 15,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#..#######.#..#",
    "#.............#",
    "#..#########..#",
    "#..#########..#",
    "#..#########..#",
    "#..#########..#",
    "#...########..#",
    "#..#########..#",
    "#..#########..#",
    "#..######.##..#",
    "#.............#",
    "#............o#",
    "###############"
  ],
  "decor": [
    "      +   +    ",
    " .`,=*+   .`,= ",
    " +   .`,=*+   +",
    " `, +     ` =* ",
    "    .`,=*+   . ",
    " ,=     +   *++",
    "            .` ",
    " =*       + +  ",
    "  .   +     `, ",
    " *+   + +      ",
    " .`     + + ,= ",
    " +       +     ",
    " `,  +  +.  =* ",
    "    .`,=*+   . ",
    " ,=*+   .`,=*++",
    "+ +  +         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 14,
      "id": "ch07-s02-armor-hall-hole"
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
      "x": 11,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 4,
      "value": 1,
      "guarded": false
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
      "x": 9,
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
      "x": 2,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 11,
      "y": 2,
      "breed": "britishShorthair",
      "patrol": 1,
      "facing": 5.7
    },
    {
      "type": "cat",
      "x": 2,
      "y": 5,
      "breed": "russianBlue",
      "patrol": 2,
      "facing": 4.08
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 6,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 12,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 9,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 1,
      "radius": 5.7,
      "intensity": 0.49,
      "flicker": 0.22,
      "on": true
    },
    {
      "x": 9,
      "y": 12,
      "radius": 5.9,
      "intensity": 0.7,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 14,
      "radius": 4.5,
      "intensity": 0.46,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 7,
      "radius": 5.5,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 0.97,
      "points": [
        {
          "x": 11,
          "y": 2
        },
        {
          "x": 12,
          "y": 12
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 2,
          "y": 5
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.07,
      "points": [
        {
          "x": 2,
          "y": 5
        },
        {
          "x": 12,
          "y": 12
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 1,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Armor Hall. The vault keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the vault. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vault. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in museum. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Armor Hall banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vault keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vault considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 13
      },
      {
        "x": 13,
        "y": 12
      }
    ],
    "searchSpots": [
      {
        "x": 13,
        "y": 12
      },
      {
        "x": 11,
        "y": 1
      },
      {
        "x": 2,
        "y": 9
      },
      {
        "x": 12,
        "y": 4
      }
    ],
    "aggression": 0.8,
    "scentBias": 0.59,
    "hearingBias": 0.74,
    "campHoleChance": 0.24,
    "leashRadius": 13
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
  "ambient": 0.55,
  "difficulty": 5.4,
  "music": "museum-echo",
  "tags": [
    "museum",
    "ring",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
