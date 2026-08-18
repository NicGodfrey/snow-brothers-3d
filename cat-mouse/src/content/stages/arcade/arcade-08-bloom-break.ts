import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-08-bloom-break",
  "chapter": 0,
  "index": 8,
  "name": "Bloom Break",
  "theme": "subway",
  "kind": "arcade",
  "seed": 730136440,
  "width": 17,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#.###.#.#.#.###.#",
    "#...............#",
    "#.#####.#.###.#.#",
    "#..........g..#.#",
    "#...........###.#",
    "#.........r.#...#",
    "#.........#g###.#",
    "#..............o#",
    "#################"
  ],
  "decor": [
    "                 ",
    "   .`,=*+   .`,= ",
    " =     . , *     ",
    "  .`,=*+   .`,=* ",
    " *     `+=     . ",
    " .`,=*+   .`,=++ ",
    "++   .`,=*+    ` ",
    " `,=*+   .`, *+  ",
    "    .`,=*+     , ",
    " ,=*+   .`,=*+   ",
    "                +"
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 9,
      "id": "arcade-08-bloom-break-hole"
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 7,
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
      "x": 8,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 7,
      "y": 7,
      "breed": "bombay",
      "patrol": 1,
      "facing": 5.36
    },
    {
      "type": "cat",
      "x": 8,
      "y": 1,
      "breed": "savannah",
      "patrol": 2,
      "facing": 0.71
    },
    {
      "type": "powerUp",
      "x": 6,
      "y": 8,
      "kind": "speed"
    },
    {
      "type": "decorProp",
      "x": 8,
      "y": 8,
      "note": "kiosk"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 1,
      "radius": 3.9,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 9,
      "radius": 3.6,
      "intensity": 0.66,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 9,
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
      "pauseSeconds": 1.22,
      "points": [
        {
          "x": 7,
          "y": 7
        },
        {
          "x": 8,
          "y": 1
        },
        {
          "x": 6,
          "y": 8
        },
        {
          "x": 8,
          "y": 8
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.49,
      "points": [
        {
          "x": 8,
          "y": 1
        },
        {
          "x": 6,
          "y": 8
        },
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 5,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Bloom Break. The kiosk keeps a second set of books."
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
      "line": "Sneak the kiosk. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the kiosk. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. maze heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Bloom Break banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The kiosk keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the kiosk considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 8
      },
      {
        "x": 15,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 15,
        "y": 3
      },
      {
        "x": 8,
        "y": 7
      },
      {
        "x": 13,
        "y": 9
      },
      {
        "x": 8,
        "y": 5
      }
    ],
    "aggression": 0.62,
    "scentBias": 0.43,
    "hearingBias": 0.66,
    "campHoleChance": 0.21,
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
  "parTime": 128,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 4,
  "music": "subway-last",
  "tags": [
    "subway",
    "maze",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
