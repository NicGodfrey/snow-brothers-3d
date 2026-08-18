import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-20-airlock-wave",
  "chapter": 0,
  "index": 20,
  "name": "Airlock Wave",
  "theme": "subway",
  "kind": "arcade",
  "seed": 3902245486,
  "width": 20,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#..................#",
    "#..p.......p...s...#",
    "#..................#",
    "#.###.####.#.#####.#",
    "#..................#",
    "#...X....X....p....#",
    "#..................#",
    "#..................#",
    "#.................o#",
    "####################"
  ],
  "decor": [
    "         +          ",
    " `,=*+   .`,=*+   . ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .` ",
    "     ,      .+     +",
    " =*+   .`,=*+   .`, ",
    "  .`==*+   .`,=*+   ",
    " *+   .`,=*+   .`,= ",
    "+.`,=*+   .`,=*+    ",
    " +   .`,=*+   .`,=* ",
    "                    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 9,
      "id": "arcade-20-airlock-wave-hole"
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 7,
      "y": 9,
      "breed": "bombay",
      "patrol": 1,
      "facing": 0.61
    },
    {
      "type": "cat",
      "x": 5,
      "y": 5,
      "breed": "savannah",
      "patrol": 2,
      "facing": 2.94
    },
    {
      "type": "powerUp",
      "x": 17,
      "y": 1,
      "kind": "magnet"
    },
    {
      "type": "hazard",
      "x": 17,
      "y": 6,
      "kind": "vacuum"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 2,
      "radius": 3.4,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 9,
      "radius": 3.7,
      "intensity": 0.53,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 2,
      "radius": 4.5,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
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
      "loop": true,
      "pauseSeconds": 0.95,
      "points": [
        {
          "x": 7,
          "y": 9
        },
        {
          "x": 5,
          "y": 5
        },
        {
          "x": 17,
          "y": 1
        },
        {
          "x": 17,
          "y": 6
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.11,
      "points": [
        {
          "x": 5,
          "y": 5
        },
        {
          "x": 17,
          "y": 1
        },
        {
          "x": 17,
          "y": 6
        },
        {
          "x": 14,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Airlock Wave. The third rail keeps a second set of books."
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
      "line": "Sneak the third rail. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the third rail. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. galleries heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Airlock Wave banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The third rail keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the third rail considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 18,
        "y": 8
      },
      {
        "x": 3,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 1
      },
      {
        "x": 3,
        "y": 7
      },
      {
        "x": 18,
        "y": 2
      },
      {
        "x": 6,
        "y": 8
      }
    ],
    "aggression": 0.66,
    "scentBias": 0.73,
    "hearingBias": 0.41,
    "campHoleChance": 0.17,
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
  "parTime": 131,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 5.4,
  "music": "subway-last",
  "tags": [
    "subway",
    "galleries",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
