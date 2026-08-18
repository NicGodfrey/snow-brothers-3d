import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s03-overflow-gate",
  "chapter": 4,
  "index": 3,
  "name": "Overflow Gate",
  "theme": "sewer",
  "kind": "story",
  "seed": 303850279,
  "width": 15,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#..###..####..#",
    "#..#~~~.~~~#..#",
    "#...~~~.~~~#..#",
    "#..#~~~.~~~#..#",
    "#..#####..r#..#",
    "#....g........#",
    "#............o#",
    "###############"
  ],
  "decor": [
    "            +  ",
    "   .`,=*+   .` ",
    " =*+   .`,=*+  ",
    "  . + *+    `, ",
    " *+   .`,=*    ",
    " .`,=*+   . ,= ",
    " +   .`,=*+    ",
    " `,    + .` =* ",
    "    .`,=*+   . ",
    " ,=*+   .`,=*+ ",
    "       + +     "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 9,
      "id": "ch04-s03-overflow-gate-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 2,
      "y": 4,
      "breed": "manx",
      "patrol": 1,
      "facing": 1.7
    },
    {
      "type": "powerUp",
      "x": 11,
      "y": 8,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 4,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 6,
      "y": 3,
      "radius": 5,
      "intensity": 0.85,
      "flicker": 0,
      "on": true
    },
    {
      "x": 8,
      "y": 8,
      "radius": 4.3,
      "intensity": 0.87,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 9,
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
      "pauseSeconds": 1.09,
      "points": [
        {
          "x": 2,
          "y": 4
        },
        {
          "x": 11,
          "y": 8
        },
        {
          "x": 6,
          "y": 3
        },
        {
          "x": 8,
          "y": 1
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Overflow Gate. The overflow keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the overflow. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the overflow. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Overflow Gate banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The overflow keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the overflow considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 8
      },
      {
        "x": 2,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 5
      },
      {
        "x": 3,
        "y": 9
      },
      {
        "x": 7,
        "y": 6
      },
      {
        "x": 10,
        "y": 1
      }
    ],
    "aggression": 0.71,
    "scentBias": 0.69,
    "hearingBias": 0.56,
    "campHoleChance": 0.06,
    "leashRadius": 10
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 4,
  "parTime": 111,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 3.5,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "ring",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
