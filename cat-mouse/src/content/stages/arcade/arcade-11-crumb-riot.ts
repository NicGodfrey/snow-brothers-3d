import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-11-crumb-riot",
  "chapter": 0,
  "index": 11,
  "name": "Crumb Riot",
  "theme": "clocktower",
  "kind": "arcade",
  "seed": 1057252346,
  "width": 19,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.#.#.#.#.#.#####.#",
    "#.#s..#.#.....#...#",
    "#.......#.#.###.#.#",
    "#.#p............#.#",
    "#.#######.#.#####.#",
    "#.#...#.#.......#.#",
    "#.#.#.#.#.#.....#.#",
    "#.#.#.#...#.....#.#",
    "#.........#.....#.#",
    "#.........#...#.s.#",
    "##........#.#####.#",
    "#.......#.#.......#",
    "#.#####.#.#.#.###.#",
    "#.....#..........o#",
    "###################"
  ],
  "decor": [
    "                   ",
    "+.`,=*+   .`,=*+   ",
    " +   . , *       = ",
    " ` =*+   .`,=*     ",
    "    .`,= +    +, * ",
    " , *+   .`,=*+   . ",
    "                 + ",
    " = +   . ,=*+   +` ",
    "   ` = +   .`,=*   ",
    " *     `,= +   . ,+",
    " .`,=*+    `,=*+   ",
    " +   .`,=*     `,= ",
    "+ ,=*+   .+,    +  ",
    "+   .`,= +   .`,=* ",
    " ,       ` = +   . ",
    "   .`, *+   .`,=*+ ",
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
      "y": 15,
      "id": "arcade-11-crumb-riot-hole"
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 16,
      "y": 3,
      "breed": "manx",
      "patrol": 1,
      "facing": 0.19
    },
    {
      "type": "cat",
      "x": 14,
      "y": 5,
      "breed": "savannah",
      "patrol": 2,
      "facing": 4.8
    },
    {
      "type": "powerUp",
      "x": 17,
      "y": 12,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 17,
      "y": 7,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 13,
      "radius": 3.5,
      "intensity": 0.47,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 11,
      "radius": 4.3,
      "intensity": 0.4,
      "flicker": 0.19,
      "on": true
    },
    {
      "x": 7,
      "y": 8,
      "radius": 4,
      "intensity": 0.6,
      "flicker": 0.26,
      "on": true
    },
    {
      "x": 17,
      "y": 10,
      "radius": 4.5,
      "intensity": 0.72,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 15,
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
      "pauseSeconds": 1.05,
      "points": [
        {
          "x": 16,
          "y": 3
        },
        {
          "x": 17,
          "y": 12
        },
        {
          "x": 14,
          "y": 5
        },
        {
          "x": 17,
          "y": 7
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.76,
      "points": [
        {
          "x": 14,
          "y": 5
        },
        {
          "x": 17,
          "y": 12
        },
        {
          "x": 17,
          "y": 7
        },
        {
          "x": 3,
          "y": 13
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Crumb Riot. The pendulum keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the pendulum. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pendulum. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
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
      "line": "Crumb Riot banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pendulum keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pendulum considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 14
      },
      {
        "x": 17,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 17,
        "y": 5
      },
      {
        "x": 11,
        "y": 15
      },
      {
        "x": 4,
        "y": 10
      },
      {
        "x": 11,
        "y": 9
      }
    ],
    "aggression": 0.7,
    "scentBias": 0.65,
    "hearingBias": 0.69,
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
  "parTime": 141,
  "lives": 3,
  "ambient": 0.38,
  "difficulty": 4.3,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "maze",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
