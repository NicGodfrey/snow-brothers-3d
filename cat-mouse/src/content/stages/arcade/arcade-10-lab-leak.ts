import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-10-lab-leak",
  "chapter": 0,
  "index": 10,
  "name": "Lab Leak",
  "theme": "greenhouse",
  "kind": "arcade",
  "seed": 1959341803,
  "width": 19,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.#.#.......#####.#",
    "#...........#.G...#",
    "#.#.....~...#.#####",
    "#.#...............#",
    "#.................#",
    "#...#G..........r.#",
    "#.#.#.#.##.##.###.#",
    "#.#.#.#.#..r......#",
    "#.#.#.#.#.###.....#",
    "#................o#",
    "###################",
    "###################"
  ],
  "decor": [
    "                   ",
    " `,=*+   .`,=*+    ",
    "     `,=*+       * ",
    " ,=*+   .`,= +   . ",
    "   .`,=*+   +`     ",
    " =++   .`,=*+   .` ",
    "  .`,=*+   .`,=*+  ",
    " *+   .`,=*+   .`, ",
    " . , *    .  =     ",
    " +   . , *+   .`,= ",
    "+` = +   .   *+    ",
    "    .`,=*+   .`,=* ",
    "    +              ",
    "       +          +"
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
      "id": "arcade-10-lab-leak-hole"
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 3,
      "value": 1,
      "guarded": false
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
      "x": 11,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 3,
      "breed": "calico",
      "patrol": 1,
      "facing": 2.75
    },
    {
      "type": "cat",
      "x": 16,
      "y": 3,
      "breed": "scottishFold",
      "patrol": 2,
      "facing": 0.83
    },
    {
      "type": "powerUp",
      "x": 1,
      "y": 4,
      "kind": "decoy"
    },
    {
      "type": "decorProp",
      "x": 9,
      "y": 11,
      "note": "seedlings"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 9,
      "radius": 5.7,
      "intensity": 0.54,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 8,
      "radius": 6,
      "intensity": 0.68,
      "flicker": 0.29,
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
      "pauseSeconds": 0.72,
      "points": [
        {
          "x": 8,
          "y": 3
        },
        {
          "x": 1,
          "y": 4
        },
        {
          "x": 16,
          "y": 3
        },
        {
          "x": 9,
          "y": 11
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.87,
      "points": [
        {
          "x": 16,
          "y": 3
        },
        {
          "x": 1,
          "y": 4
        },
        {
          "x": 9,
          "y": 11
        },
        {
          "x": 7,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Lab Leak. The seedlings keeps a second set of books."
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
      "line": "Sneak the seedlings. Dash is postage. The maze layout lies about shortcuts.",
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
      "line": "Lab Leak banked. Whiskers attached."
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
        "x": 17,
        "y": 10
      },
      {
        "x": 17,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 17,
        "y": 2
      },
      {
        "x": 6,
        "y": 5
      },
      {
        "x": 9,
        "y": 3
      },
      {
        "x": 1,
        "y": 7
      }
    ],
    "aggression": 0.62,
    "scentBias": 0.65,
    "hearingBias": 0.6,
    "campHoleChance": 0.19,
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
  "parTime": 136,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 4.2,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "maze",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
