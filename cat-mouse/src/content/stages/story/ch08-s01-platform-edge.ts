import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s01-platform-edge",
  "chapter": 8,
  "index": 1,
  "name": "Platform Edge",
  "theme": "subway",
  "kind": "story",
  "seed": 2824070314,
  "width": 19,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.###...#.###.#.#.#",
    "#.......s...#p#...#",
    "#.##..s..##.#.....#",
    "#.........#.......#",
    "#.#...#.#.#.#.....#",
    "#.#.......#.#...#.#",
    "#.#X###.#####...#.#",
    "#.#g#.......#...g.#",
    "#.#.#.#####.#...#.#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "      +           +",
    " *+   .`,=*+   .`, ",
    " .   *+      = +  +",
    " +   .`,=*+    `,= ",
    " `  *+     , *+   +",
    "    .`,=*+   .`,=* ",
    " , *+    ` = +   . ",
    "   .`,=*+    `,= + ",
    "+=     .         ` ",
    "   ` =*+   . ,=*+  ",
    " *      +  +   . ,+",
    " .`,=*+   .`,=*+   ",
    "                   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 11,
      "id": "ch08-s01-platform-edge-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 9,
      "value": 1,
      "guarded": true
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
      "x": 7,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 4,
      "y": 11,
      "breed": "savannah",
      "patrol": 1,
      "facing": 1.14
    },
    {
      "type": "cat",
      "x": 15,
      "y": 4,
      "breed": "siamese",
      "patrol": 2,
      "facing": 2.52
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 9,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 5,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 6,
      "kind": "vacuum"
    },
    {
      "type": "decorProp",
      "x": 15,
      "y": 2,
      "note": "turnstile"
    }
  ],
  "lights": [
    {
      "x": 13,
      "y": 6,
      "radius": 4.6,
      "intensity": 0.87,
      "flicker": 0.3,
      "on": true
    },
    {
      "x": 17,
      "y": 7,
      "radius": 5.3,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 4,
      "radius": 3.9,
      "intensity": 0.54,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "loop": false,
      "pauseSeconds": 0.6,
      "points": [
        {
          "x": 4,
          "y": 11
        },
        {
          "x": 15,
          "y": 4
        },
        {
          "x": 4,
          "y": 5
        },
        {
          "x": 3,
          "y": 9
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.46,
      "points": [
        {
          "x": 15,
          "y": 4
        },
        {
          "x": 4,
          "y": 5
        },
        {
          "x": 3,
          "y": 9
        },
        {
          "x": 3,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Platform Edge. The turnstile keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the turnstile. Dash is postage. The maze layout lies about shortcuts.",
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
      "line": "Half of 6. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Platform Edge banked. Whiskers attached."
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
        "x": 17,
        "y": 10
      },
      {
        "x": 1,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 7
      },
      {
        "x": 17,
        "y": 9
      },
      {
        "x": 6,
        "y": 1
      },
      {
        "x": 7,
        "y": 9
      }
    ],
    "aggression": 0.92,
    "scentBias": 0.43,
    "hearingBias": 0.57,
    "campHoleChance": 0.25,
    "leashRadius": 14
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
  "parTime": 142,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6,
  "music": "subway-last",
  "tags": [
    "subway",
    "maze",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
