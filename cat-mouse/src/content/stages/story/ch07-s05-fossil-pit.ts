import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s05-fossil-pit",
  "chapter": 7,
  "index": 5,
  "name": "Fossil Pit",
  "theme": "museum",
  "kind": "story",
  "seed": 328342819,
  "width": 17,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#.#.#.....#.#.#.#",
    "#...#.....#.....#",
    "#.###.....s..##.#",
    "#.......#.......#",
    "#.###.#.##...#..#",
    "#.#...#D......#.#",
    "#.............#.#",
    "#.............#.#",
    "#.#.#.####....#.#",
    "#.............#.#",
    "#.###.#.#...G.#.#",
    "#.....#...#....o#",
    "#################"
  ],
  "decor": [
    "+         +      ",
    "+*+   .`,=*+   . ",
    " . , *+    ` = + ",
    " +   .`,=*+   .` ",
    " `   +   .`,=    ",
    "    .`,= +   .`, ",
    " , +      ,=*   +",
    "   .`,  +   .` = ",
    " =*+   .`,=*+    ",
    "  .`,=*+   .`, * ",
    " *    +   *+   . ",
    " .`,=*+   .`,= + ",
    " +   . , *+    ` ",
    " `,=*+   . ,=*+  ",
    "           +   + "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 13,
      "id": "ch07-s05-fossil-pit-hole"
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
      "x": 11,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 13,
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
      "x": 13,
      "y": 8,
      "value": 1,
      "guarded": false
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
      "x": 13,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 10,
      "y": 12,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 1.09
    },
    {
      "type": "cat",
      "x": 5,
      "y": 7,
      "breed": "britishShorthair",
      "patrol": 2,
      "facing": 0.91
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 9,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 13,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 5,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 11,
      "y": 8,
      "keyId": "ch07-s05-fossil-pit-key"
    },
    {
      "type": "door",
      "x": 7,
      "y": 7,
      "id": "ch07-s05-fossil-pit-door",
      "locked": true,
      "keyId": "ch07-s05-fossil-pit-key"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 13,
      "note": "vase"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 7,
      "radius": 6,
      "intensity": 0.57,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 3,
      "radius": 4.3,
      "intensity": 0.81,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 4,
      "radius": 3.8,
      "intensity": 0.73,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 13,
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
      "pauseSeconds": 0.6,
      "points": [
        {
          "x": 10,
          "y": 12
        },
        {
          "x": 5,
          "y": 7
        },
        {
          "x": 3,
          "y": 9
        },
        {
          "x": 9,
          "y": 13
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.28,
      "points": [
        {
          "x": 5,
          "y": 7
        },
        {
          "x": 3,
          "y": 9
        },
        {
          "x": 9,
          "y": 13
        },
        {
          "x": 1,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Fossil Pit. The armor keeps a second set of books."
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
      "line": "Sneak the armor. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the armor. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in museum. Verbs are edible."
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
      "line": "Fossil Pit banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The armor keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the armor considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 12
      },
      {
        "x": 12,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 11
      },
      {
        "x": 11,
        "y": 12
      },
      {
        "x": 5,
        "y": 13
      },
      {
        "x": 9,
        "y": 9
      }
    ],
    "aggression": 0.75,
    "scentBias": 0.58,
    "hearingBias": 0.69,
    "campHoleChance": 0.17,
    "leashRadius": 13
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
  "parTime": 143,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 5.8,
  "music": "museum-echo",
  "tags": [
    "museum",
    "maze",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
