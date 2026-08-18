import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-16-third-rail-jam",
  "chapter": 0,
  "index": 16,
  "name": "Third Rail Jam",
  "theme": "sewer",
  "kind": "arcade",
  "seed": 3019380319,
  "width": 15,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#..X...X...g..#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.##.#.#..###.#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#............o#",
    "###############"
  ],
  "decor": [
    "     +   +++   ",
    "   .`,=*+   .` ",
    " =*=    `,=*+  ",
    "  .`,=*+   .`, ",
    " *+   .`,=*+   ",
    " .`,=*+   .`,= ",
    " +    ` =*     ",
    "+`,=*+   .`,=* ",
    "    .`,=*+   . ",
    "+,=*+   .`,=*+ ",
    "   .`,=*+   .` ",
    " =*+   .`,=*+  ",
    "  .`,=*+   .`, ",
    "      +        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 12,
      "id": "arcade-16-third-rail-jam-hole"
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 6,
      "y": 12,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 3.97
    },
    {
      "type": "cat",
      "x": 5,
      "y": 2,
      "breed": "norwegianForest",
      "patrol": 2,
      "facing": 3.34
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 5,
      "kind": "timeSlip"
    },
    {
      "type": "decorProp",
      "x": 12,
      "y": 5,
      "note": "grate well"
    }
  ],
  "lights": [
    {
      "x": 13,
      "y": 6,
      "radius": 5,
      "intensity": 0.67,
      "flicker": 0.11,
      "on": true
    },
    {
      "x": 6,
      "y": 3,
      "radius": 3.3,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 8,
      "radius": 3.9,
      "intensity": 0.77,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 1.21,
      "points": [
        {
          "x": 6,
          "y": 12
        },
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 3,
          "y": 5
        },
        {
          "x": 12,
          "y": 5
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.44,
      "points": [
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 3,
          "y": 5
        },
        {
          "x": 12,
          "y": 5
        },
        {
          "x": 13,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Third Rail Jam. The outflow keeps a second set of books."
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
      "line": "Sneak the outflow. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the outflow. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
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
      "line": "Third Rail Jam banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The outflow keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the outflow considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 11
      },
      {
        "x": 11,
        "y": 8
      }
    ],
    "searchSpots": [
      {
        "x": 11,
        "y": 8
      },
      {
        "x": 6,
        "y": 11
      },
      {
        "x": 7,
        "y": 1
      },
      {
        "x": 10,
        "y": 3
      }
    ],
    "aggression": 0.63,
    "scentBias": 0.57,
    "hearingBias": 0.58,
    "campHoleChance": 0.18,
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
  "parTime": 130,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 4.9,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "galleries",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
