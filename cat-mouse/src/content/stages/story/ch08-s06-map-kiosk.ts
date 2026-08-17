import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s06-map-kiosk",
  "chapter": 8,
  "index": 6,
  "name": "Map Kiosk",
  "theme": "subway",
  "kind": "story",
  "seed": 2097787383,
  "width": 16,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#.......##.....#",
    "#.......##...g.#",
    "#.......##.....#",
    "#.g.....##.....#",
    "#.......##.....#",
    "#..............#",
    "#.......##.....#",
    "#..............#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "    +           ",
    "  .`,=*+   .`,= ",
    " *+   .`  *+    ",
    " .`,=*+   .`,=* ",
    " +   .`,  +   . ",
    " `,=*+    `,=*+ ",
    "    .`,=     .` ",
    " ,=*+   .`,=*+  ",
    "   .`,=*    .`, ",
    " =*+   .`,=*+   ",
    "  .`,=*+   .`,= ",
    " *+   .`,=*+    ",
    "               +"
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
      "id": "ch08-s06-map-kiosk-hole"
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 3,
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
      "x": 11,
      "y": 1,
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
      "x": 6,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 10,
      "y": 8,
      "breed": "siamese",
      "patrol": 1,
      "facing": 6.13
    },
    {
      "type": "cat",
      "x": 6,
      "y": 5,
      "breed": "abyssinian",
      "patrol": 2,
      "facing": 5.29
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 1,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 7,
      "kind": "fan"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 11,
      "radius": 3.6,
      "intensity": 0.74,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 11,
      "radius": 5.5,
      "intensity": 0.84,
      "flicker": 0.14,
      "on": true
    },
    {
      "x": 1,
      "y": 11,
      "radius": 3.8,
      "intensity": 0.83,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 6,
      "radius": 6,
      "intensity": 0.64,
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
      "pauseSeconds": 1.24,
      "points": [
        {
          "x": 10,
          "y": 8
        },
        {
          "x": 6,
          "y": 5
        },
        {
          "x": 7,
          "y": 1
        },
        {
          "x": 8,
          "y": 7
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.13,
      "points": [
        {
          "x": 6,
          "y": 5
        },
        {
          "x": 7,
          "y": 1
        },
        {
          "x": 8,
          "y": 7
        },
        {
          "x": 10,
          "y": 11
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Map Kiosk. The turnstile keeps a second set of books."
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
      "line": "Sneak the turnstile. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the turnstile. Heavy. Mine until the hole says otherwise."
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
      "line": "Map Kiosk banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The turnstile keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the turnstile considers creaking.",
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
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 10,
        "y": 9
      },
      {
        "x": 5,
        "y": 11
      },
      {
        "x": 4,
        "y": 3
      },
      {
        "x": 11,
        "y": 10
      }
    ],
    "aggression": 0.9,
    "scentBias": 0.43,
    "hearingBias": 0.71,
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
  "difficulty": 6.6,
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
