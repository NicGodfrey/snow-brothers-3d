import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s02-grate-gallery",
  "chapter": 4,
  "index": 2,
  "name": "Grate Gallery",
  "theme": "sewer",
  "kind": "story",
  "seed": 130858007,
  "width": 16,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#............g.#",
    "#..............#",
    "#...##########.#",
    "#..............#",
    "#..............#",
    "#..............#",
    "#.#.########.#.#",
    "#..............#",
    "#............D.#",
    "#.............o#",
    "################",
    "################",
    "################"
  ],
  "decor": [
    "        +       ",
    " =*+   .`,=*+   ",
    "  .`,=*+   .`,=+",
    " *+   .`,=*+    ",
    " .`,       +  * ",
    " +   .`,=*+   . ",
    " `,=*+   .`,=*+ ",
    "+   .`,=*+   .` ",
    " , *        *   ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+   ",
    "  .`,=*+   .`,= ",
    "           +    ",
    "              + ",
    "              + "
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
      "id": "ch04-s02-grate-gallery-hole"
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 10,
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
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 1,
      "y": 6,
      "breed": "bombay",
      "patrol": 1,
      "facing": 1.76
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 6,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 2,
      "kind": "fan"
    },
    {
      "type": "key",
      "x": 14,
      "y": 3,
      "keyId": "ch04-s02-grate-gallery-key"
    },
    {
      "type": "door",
      "x": 13,
      "y": 10,
      "id": "ch04-s02-grate-gallery-door",
      "locked": true,
      "keyId": "ch04-s02-grate-gallery-key"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 10,
      "radius": 5.8,
      "intensity": 0.66,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 2,
      "radius": 5.5,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 6,
      "radius": 3.6,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 2,
      "radius": 5.3,
      "intensity": 0.59,
      "flicker": 0.13,
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
      "pauseSeconds": 0.42,
      "points": [
        {
          "x": 1,
          "y": 6
        },
        {
          "x": 13,
          "y": 6
        },
        {
          "x": 9,
          "y": 2
        },
        {
          "x": 14,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Grate Gallery. The pump keeps a second set of books."
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
      "line": "Sneak the pump. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pump. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Grate Gallery banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pump keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pump considers creaking.",
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
        "x": 3,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 9
      },
      {
        "x": 2,
        "y": 10
      },
      {
        "x": 10,
        "y": 1
      },
      {
        "x": 3,
        "y": 3
      }
    ],
    "aggression": 0.63,
    "scentBias": 0.36,
    "hearingBias": 0.56,
    "campHoleChance": 0.2,
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
  "parTime": 118,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 3.3,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "channels",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
