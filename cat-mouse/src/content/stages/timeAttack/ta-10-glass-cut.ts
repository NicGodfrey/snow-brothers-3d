import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-10-glass-cut",
  "chapter": 0,
  "index": 10,
  "name": "Glass Cut",
  "theme": "greenhouse",
  "kind": "timeAttack",
  "seed": 1395855850,
  "width": 16,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "################",
    "#.......##.....#",
    "#..r....##.....#",
    "#.......##.....#",
    "#.......##.....#",
    "#..............#",
    "#..............#",
    "#.......##...r.#",
    "#.......##.....#",
    "#.......##.....#",
    "#.............o#",
    "################"
  ],
  "decor": [
    " +          ++  ",
    " *+   .`  *+    ",
    " .`,=*+   .`,=* ",
    " +   .`,  +   . ",
    " `,=*+    `,=*+ ",
    "    .`,=*+   .` ",
    " ,=*+   .`,=*+  ",
    "   .`,=*    .`, ",
    " =*+   .  =*+   ",
    "  .`,=*+ + .`,= ",
    " *+   .`,=*+    ",
    "                "
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
      "id": "ta-10-glass-cut-hole"
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
      "x": 5,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 6,
      "y": 10,
      "breed": "calico",
      "patrol": 1,
      "facing": 0.55
    },
    {
      "type": "hazard",
      "x": 5,
      "y": 10,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 2,
      "note": "mist"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 5,
      "radius": 4.1,
      "intensity": 0.9,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 9,
      "radius": 4.5,
      "intensity": 0.68,
      "flicker": 0,
      "on": true
    },
    {
      "x": 3,
      "y": 4,
      "radius": 4.8,
      "intensity": 0.81,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 9,
      "radius": 4.8,
      "intensity": 0.41,
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
      "pauseSeconds": 0.79,
      "points": [
        {
          "x": 6,
          "y": 10
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 10,
          "y": 5
        },
        {
          "x": 12,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Glass Cut. The seedlings keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the seedlings. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the seedlings. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
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
      "line": "Glass Cut banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The seedlings keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the seedlings considers creaking.",
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
        "x": 6,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 6,
        "y": 1
      },
      {
        "x": 5,
        "y": 5
      },
      {
        "x": 6,
        "y": 7
      },
      {
        "x": 14,
        "y": 6
      }
    ],
    "aggression": 0.48,
    "scentBias": 0.62,
    "hearingBias": 0.35,
    "campHoleChance": 0.07,
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
  "ambient": 0.5,
  "difficulty": 2.2,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "dual",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
