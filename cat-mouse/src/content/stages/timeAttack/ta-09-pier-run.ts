import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-09-pier-run",
  "chapter": 0,
  "index": 9,
  "name": "Pier Run",
  "theme": "docks",
  "kind": "timeAttack",
  "seed": 3372090260,
  "width": 16,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#.....##.......#",
    "#.....##.......#",
    "#.....##..X....#",
    "#.....##.......#",
    "#.....##.......#",
    "#.....##.....L.#",
    "#....p.........#",
    "#.....##.......#",
    "#.....##......o#",
    "################"
  ],
  "decor": [
    "+++           + ",
    " =*+   .`,=*+   ",
    "  .`,=+    .`,= ",
    " *+     ,=*+    ",
    " .`,=*     `,=* ",
    " +   .  =*+   . ",
    " `,=*+   .`,=*+ ",
    "    .`  *+   .` ",
    " ,=*+   .`,=*+  ",
    "   .`,  +   .`, ",
    " =*+   +`,=*+   ",
    "          + +   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 10,
      "id": "ta-09-pier-run-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 1,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 1.03
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 5,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 12,
      "y": 1,
      "note": "pier"
    }
  ],
  "lights": [
    {
      "x": 12,
      "y": 5,
      "radius": 5.3,
      "intensity": 0.77,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 9,
      "radius": 5,
      "intensity": 0.69,
      "flicker": 0.34,
      "on": true
    },
    {
      "x": 14,
      "y": 10,
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
      "pauseSeconds": 0.33,
      "points": [
        {
          "x": 8,
          "y": 1
        },
        {
          "x": 14,
          "y": 5
        },
        {
          "x": 12,
          "y": 1
        },
        {
          "x": 12,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Pier Run. The pier keeps a second set of books."
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
      "line": "Sneak the pier. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pier. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Pier Run banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pier keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pier considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 9
      },
      {
        "x": 1,
        "y": 8
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 8
      },
      {
        "x": 8,
        "y": 3
      },
      {
        "x": 13,
        "y": 5
      },
      {
        "x": 4,
        "y": 6
      }
    ],
    "aggression": 0.44,
    "scentBias": 0.55,
    "hearingBias": 0.8,
    "campHoleChance": 0.14,
    "leashRadius": 6
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "timeLimit",
      "value": 98,
      "optional": false,
      "label": "Beat 98s"
    }
  ],
  "quota": 4,
  "parTime": 98,
  "lives": 2,
  "ambient": 0.32,
  "difficulty": 2.1,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "dual",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
