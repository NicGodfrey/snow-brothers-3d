import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-05-rafter-line",
  "chapter": 0,
  "index": 5,
  "name": "Rafter Line",
  "theme": "attic",
  "kind": "timeAttack",
  "seed": 4022305367,
  "width": 17,
  "height": 10,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#....r..........#",
    "#...............#",
    "#...............#",
    "#..........r....#",
    "#..............o#",
    "#################",
    "#################",
    "#################"
  ],
  "decor": [
    "                 ",
    " =*+   .`,=*+    ",
    "  .`,=*+   .`,=* ",
    " *+   .`,=*+   . ",
    "+.`,=*+   .`,=*+ ",
    " +   .`,=*+   .` ",
    " `,=*+   .`,=*+  ",
    "             +   ",
    "              +  ",
    "          +      "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 6,
      "id": "ta-05-rafter-line-hole"
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 4,
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
      "x": 11,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 2,
      "y": 5,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 4.92
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 3,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 9,
      "y": 3,
      "note": "chimney"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 4,
      "radius": 4.8,
      "intensity": 0.89,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 4,
      "radius": 4.8,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 6,
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
      "pauseSeconds": 0.49,
      "points": [
        {
          "x": 2,
          "y": 5
        },
        {
          "x": 8,
          "y": 3
        },
        {
          "x": 8,
          "y": 5
        },
        {
          "x": 13,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Rafter Line. The dormer keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 3. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the dormer. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the dormer. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 3. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Rafter Line banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The dormer keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the dormer considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 5
      },
      {
        "x": 15,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 15,
        "y": 4
      },
      {
        "x": 12,
        "y": 1
      },
      {
        "x": 11,
        "y": 4
      },
      {
        "x": 7,
        "y": 3
      }
    ],
    "aggression": 0.43,
    "scentBias": 0.46,
    "hearingBias": 0.74,
    "campHoleChance": 0.17,
    "leashRadius": 6
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 3,
      "optional": false,
      "label": "Bank 3 cheese"
    },
    {
      "kind": "timeLimit",
      "value": 88,
      "optional": false,
      "label": "Beat 88s"
    }
  ],
  "quota": 3,
  "parTime": 88,
  "lives": 2,
  "ambient": 0.4,
  "difficulty": 1.6,
  "music": "attic-moths",
  "tags": [
    "attic",
    "channels",
    "timeAttack",
    "solo-cat",
    "q3"
  ]
};

export default stage;
