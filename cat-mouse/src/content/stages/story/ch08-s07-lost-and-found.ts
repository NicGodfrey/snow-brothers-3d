import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s07-lost-and-found",
  "chapter": 8,
  "index": 7,
  "name": "Lost And Found",
  "theme": "subway",
  "kind": "story",
  "seed": 2204924158,
  "width": 16,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#.......##.....#",
    "#.......##.....#",
    "#.......##.....#",
    "#..g....##.....#",
    "#.......##.....#",
    "#.......##.....#",
    "#.g.....##.g.g.#",
    "#.......##.....#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "        +     + ",
    "   .`,=*+   .`, ",
    " =*+   .  =*+   ",
    "  .`,=*+   .`,= ",
    " *+   .`  *+    ",
    " .`,=*+   .`,=* ",
    " +   .`,  +   . ",
    " `,=*+  + `,=*+ ",
    "    .`,=     .` ",
    " ,=*+     ,=*+  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "    +           "
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
      "id": "ch08-s07-lost-and-found-hole"
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 11,
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
      "x": 4,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 2,
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
      "type": "cat",
      "x": 5,
      "y": 6,
      "breed": "abyssinian",
      "patrol": 1,
      "facing": 4.41
    },
    {
      "type": "cat",
      "x": 1,
      "y": 8,
      "breed": "bombay",
      "patrol": 2,
      "facing": 4.81
    },
    {
      "type": "powerUp",
      "x": 2,
      "y": 11,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 5,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 2,
      "note": "third rail"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 11,
      "radius": 3.2,
      "intensity": 0.61,
      "flicker": 0,
      "on": true
    },
    {
      "x": 3,
      "y": 1,
      "radius": 5.2,
      "intensity": 0.72,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 5,
      "radius": 6.1,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 9,
      "radius": 6,
      "intensity": 0.67,
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
      "pauseSeconds": 1.45,
      "points": [
        {
          "x": 5,
          "y": 6
        },
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 2,
          "y": 11
        },
        {
          "x": 10,
          "y": 5
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.53,
      "points": [
        {
          "x": 1,
          "y": 8
        },
        {
          "x": 2,
          "y": 11
        },
        {
          "x": 10,
          "y": 5
        },
        {
          "x": 11,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Lost And Found. The platform keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the platform. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the platform. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Lost And Found banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The platform keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the platform considers creaking.",
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
        "x": 6,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 6,
        "y": 11
      },
      {
        "x": 4,
        "y": 1
      },
      {
        "x": 9,
        "y": 11
      },
      {
        "x": 11,
        "y": 10
      }
    ],
    "aggression": 0.93,
    "scentBias": 0.47,
    "hearingBias": 0.42,
    "campHoleChance": 0.3,
    "leashRadius": 14
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
  "parTime": 146,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6.7,
  "music": "subway-last",
  "tags": [
    "subway",
    "dual",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
