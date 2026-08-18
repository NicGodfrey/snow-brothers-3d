import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s06-compost-heap",
  "chapter": 10,
  "index": 6,
  "name": "Compost Heap",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 1739353592,
  "width": 17,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#..........X....#",
    "#...............#",
    "#...............#",
    "#...........D...#",
    "#..###....#####.#",
    "#...............#",
    "#...............#",
    "#...............#",
    "#...............#",
    "#...............#",
    "#..............o#",
    "#################"
  ],
  "decor": [
    "             +   ",
    "    .`,=*+   .`, ",
    " ,=*+   .`, *+   ",
    "   .`,=*+   .`,= ",
    "+=*+   .`,=*+    ",
    "  .`,=*+   . ,=* ",
    " *+   .`,=   + . ",
    " .`,=*+   .`,=*+ ",
    " +   .`,=*+   .` ",
    " `,=*+   .`,=*+  ",
    "    .`,=*+   .`, ",
    " ,=*+   .`,=*+   ",
    "   .`,=*+   .`,= ",
    "            +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 12,
      "id": "ch10-s06-compost-heap-hole"
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 8,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 2,
      "breed": "abyssinian",
      "patrol": 1,
      "facing": 1.8
    },
    {
      "type": "cat",
      "x": 12,
      "y": 3,
      "breed": "sphynx",
      "patrol": 2,
      "facing": 5.17
    },
    {
      "type": "powerUp",
      "x": 5,
      "y": 2,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 5,
      "kind": "water"
    },
    {
      "type": "key",
      "x": 5,
      "y": 8,
      "keyId": "ch10-s06-compost-heap-key"
    },
    {
      "type": "door",
      "x": 12,
      "y": 5,
      "id": "ch10-s06-compost-heap-door",
      "locked": true,
      "keyId": "ch10-s06-compost-heap-key"
    },
    {
      "type": "decorProp",
      "x": 6,
      "y": 11,
      "note": "agave"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 10,
      "radius": 3.9,
      "intensity": 0.76,
      "flicker": 0.12,
      "on": true
    },
    {
      "x": 10,
      "y": 7,
      "radius": 4.9,
      "intensity": 0.73,
      "flicker": 0.17,
      "on": true
    },
    {
      "x": 1,
      "y": 9,
      "radius": 3.4,
      "intensity": 0.63,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 12,
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
      "pauseSeconds": 0.73,
      "points": [
        {
          "x": 8,
          "y": 2
        },
        {
          "x": 12,
          "y": 3
        },
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 14,
          "y": 5
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.02,
      "points": [
        {
          "x": 12,
          "y": 3
        },
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 14,
          "y": 5
        },
        {
          "x": 5,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Compost Heap. The mist keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the mist. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the mist. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Compost Heap banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The mist keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the mist considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 11
      },
      {
        "x": 10,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 10,
        "y": 2
      },
      {
        "x": 12,
        "y": 11
      },
      {
        "x": 13,
        "y": 8
      },
      {
        "x": 8,
        "y": 12
      }
    ],
    "aggression": 1.04,
    "scentBias": 0.48,
    "hearingBias": 0.66,
    "campHoleChance": 0.25,
    "leashRadius": 16
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 8,
      "optional": false,
      "label": "Bank 8 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 8,
  "parTime": 157,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 8,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "galleries",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
