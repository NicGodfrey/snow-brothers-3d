import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-09-bell-sprint",
  "chapter": 0,
  "index": 9,
  "name": "Bell Sprint",
  "theme": "docks",
  "kind": "arcade",
  "seed": 3061998583,
  "width": 16,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#....##........#",
    "#...L##........#",
    "#....##........#",
    "#....##........#",
    "#.L..##..~.....#",
    "#....##........#",
    "#....##........#",
    "#..............#",
    "#....##........#",
    "#....##........#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "       +       +",
    " `,=*+   .`,=*+ ",
    "    .  =*+   .` ",
    " ,=*+   .`,=*+  ",
    "   .`  *+   .`,+",
    " =*+   .`,=*+   ",
    "  .`,  +   .`,= ",
    " *+    `,=*+    ",
    " .`,=+    .`,=* ",
    " +   .`,=*+   . ",
    " `,=*    .`,=*++",
    "    .  =*+   .` ",
    " ,=*+   .`,=*+  ",
    "+  .`,=*+   .`,+",
    "        +       "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 13,
      "id": "arcade-09-bell-sprint-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 6,
      "y": 13,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 6.2
    },
    {
      "type": "cat",
      "x": 7,
      "y": 1,
      "breed": "sphynx",
      "patrol": 2,
      "facing": 4.03
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 4,
      "kind": "extraLife"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 3,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 8,
      "note": "cold storage"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 2,
      "radius": 4.3,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 11,
      "radius": 3.8,
      "intensity": 0.57,
      "flicker": 0.23,
      "on": true
    },
    {
      "x": 14,
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
      "loop": true,
      "pauseSeconds": 1.56,
      "points": [
        {
          "x": 6,
          "y": 13
        },
        {
          "x": 7,
          "y": 1
        },
        {
          "x": 8,
          "y": 4
        },
        {
          "x": 3,
          "y": 3
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.81,
      "points": [
        {
          "x": 7,
          "y": 1
        },
        {
          "x": 8,
          "y": 4
        },
        {
          "x": 3,
          "y": 3
        },
        {
          "x": 1,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Bell Sprint. The nets keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the nets. Dash is postage. The dual layout lies about shortcuts.",
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
      "line": "Half of 5. dual heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Bell Sprint banked. Whiskers attached."
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
        "x": 14,
        "y": 12
      },
      {
        "x": 1,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 5
      },
      {
        "x": 1,
        "y": 12
      },
      {
        "x": 3,
        "y": 12
      },
      {
        "x": 13,
        "y": 9
      }
    ],
    "aggression": 0.67,
    "scentBias": 0.42,
    "hearingBias": 0.79,
    "campHoleChance": 0.27,
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
  "parTime": 133,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 4.1,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "dual",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
