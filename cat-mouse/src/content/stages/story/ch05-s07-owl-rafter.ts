import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s07-owl-rafter",
  "chapter": 5,
  "index": 7,
  "name": "Owl Rafter",
  "theme": "attic",
  "kind": "story",
  "seed": 1399930010,
  "width": 16,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#......D.......#",
    "#..............#",
    "#.####.###.#####",
    "#..............#",
    "#..............#",
    "#..............#",
    "#.######.#######",
    "#.....X........#",
    "#..............#",
    "#.............o#",
    "################",
    "################",
    "################",
    "################"
  ],
  "decor": [
    "                ",
    " .`,=*+   .`,=* ",
    " +   .` =*+   . ",
    "+`,=*+   .`,=*+ ",
    "     +,         ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "   +   +        ",
    " *+    `,=*+    ",
    " .`,=*+   .`,=* ",
    " +   .`,=*+   . ",
    "                ",
    "         +      ",
    "   +        +   ",
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
      "y": 11,
      "id": "ch05-s07-owl-rafter-hole"
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 6,
      "y": 4,
      "breed": "ragdoll",
      "patrol": 1,
      "facing": 4.52
    },
    {
      "type": "powerUp",
      "x": 9,
      "y": 2,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 11,
      "kind": "snapTrap"
    },
    {
      "type": "key",
      "x": 7,
      "y": 7,
      "keyId": "ch05-s07-owl-rafter-key"
    },
    {
      "type": "door",
      "x": 7,
      "y": 2,
      "id": "ch05-s07-owl-rafter-door",
      "locked": true,
      "keyId": "ch05-s07-owl-rafter-key"
    },
    {
      "type": "decorProp",
      "x": 2,
      "y": 11,
      "note": "hatbox"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 1,
      "radius": 5.5,
      "intensity": 0.62,
      "flicker": 0.3,
      "on": true
    },
    {
      "x": 7,
      "y": 11,
      "radius": 6,
      "intensity": 0.84,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 2,
      "radius": 4.4,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 11,
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
          "x": 6,
          "y": 4
        },
        {
          "x": 9,
          "y": 2
        },
        {
          "x": 1,
          "y": 11
        },
        {
          "x": 7,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Owl Rafter. The hatbox keeps a second set of books."
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
      "line": "Sneak the hatbox. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the hatbox. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Owl Rafter banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The hatbox keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the hatbox considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 10
      },
      {
        "x": 10,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 10,
        "y": 6
      },
      {
        "x": 12,
        "y": 5
      },
      {
        "x": 8,
        "y": 6
      },
      {
        "x": 13,
        "y": 1
      }
    ],
    "aggression": 0.71,
    "scentBias": 0.64,
    "hearingBias": 0.44,
    "campHoleChance": 0.11,
    "leashRadius": 11
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
  "parTime": 136,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4.6,
  "music": "attic-moths",
  "tags": [
    "attic",
    "channels",
    "story",
    "solo-cat",
    "q6"
  ]
};

export default stage;
