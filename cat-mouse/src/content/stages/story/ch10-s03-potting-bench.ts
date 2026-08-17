import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch10-s03-potting-bench",
  "chapter": 10,
  "index": 3,
  "name": "Potting Bench",
  "theme": "greenhouse",
  "kind": "story",
  "seed": 3643955186,
  "width": 20,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#.................##",
    "#...###.#.#######.##",
    "#.....#.X.#..D....##",
    "#..............#####",
    "#...#.....#....r..##",
    "#.........#.#.r.#.##",
    "#...#.....#...r.#.##",
    "#..............T####",
    "#..o#.#.....#.#...##",
    "#..##.#####.#####.##",
    "#.................##",
    "####################"
  ],
  "decor": [
    "      +           + ",
    " =*+   .`,=*+   .`  ",
    "  .`   +            ",
    " *+    ` = + = .`, +",
    " .`,=*+   .`,=*     ",
    " +  +.`,=*    .`,=  ",
    " `,=*+   . , *+     ",
    "     `,=*+   .`, *  ",
    " ,=*+   .`,=*+      ",
    "   .+, *+    ` =*+  ",
    " =*    ++  *     `  ",
    "  .`,=*+   .`,=*+   ",
    "           +      ++"
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 3,
      "y": 9,
      "id": "ch10-s03-potting-bench-hole"
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 4,
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
      "x": 5,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 5,
      "y": 7,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 6.18
    },
    {
      "type": "cat",
      "x": 8,
      "y": 7,
      "breed": "calico",
      "patrol": 2,
      "facing": 2.21
    },
    {
      "type": "powerUp",
      "x": 1,
      "y": 9,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 3,
      "kind": "water"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 11,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 11,
      "kind": "fan"
    },
    {
      "type": "key",
      "x": 15,
      "y": 5,
      "keyId": "ch10-s03-potting-bench-key"
    },
    {
      "type": "door",
      "x": 13,
      "y": 3,
      "id": "ch10-s03-potting-bench-door",
      "locked": true,
      "keyId": "ch10-s03-potting-bench-key"
    },
    {
      "type": "decorProp",
      "x": 5,
      "y": 11,
      "note": "orchids"
    }
  ],
  "lights": [
    {
      "x": 9,
      "y": 7,
      "radius": 3.5,
      "intensity": 0.7,
      "flicker": 0.3,
      "on": true
    },
    {
      "x": 11,
      "y": 9,
      "radius": 5.3,
      "intensity": 0.49,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 7,
      "radius": 4.8,
      "intensity": 0.47,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 11,
      "radius": 5.9,
      "intensity": 0.76,
      "flicker": 0.1,
      "on": true
    },
    {
      "x": 3,
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
      "pauseSeconds": 0.92,
      "points": [
        {
          "x": 5,
          "y": 7
        },
        {
          "x": 8,
          "y": 7
        },
        {
          "x": 1,
          "y": 9
        },
        {
          "x": 14,
          "y": 3
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.38,
      "points": [
        {
          "x": 8,
          "y": 7
        },
        {
          "x": 1,
          "y": 9
        },
        {
          "x": 14,
          "y": 3
        },
        {
          "x": 11,
          "y": 11
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Potting Bench. The seedlings keeps a second set of books."
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
      "line": "Half of 7. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Potting Bench banked. Whiskers attached."
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
        "x": 3,
        "y": 8
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
        "x": 14,
        "y": 8
      },
      {
        "x": 14,
        "y": 4
      },
      {
        "x": 1,
        "y": 7
      }
    ],
    "aggression": 0.91,
    "scentBias": 0.56,
    "hearingBias": 0.45,
    "campHoleChance": 0.25,
    "leashRadius": 16
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
  "parTime": 151,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 7.7,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "maze",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
