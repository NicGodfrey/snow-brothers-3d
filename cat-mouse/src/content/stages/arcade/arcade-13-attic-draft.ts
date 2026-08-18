import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-13-attic-draft",
  "chapter": 0,
  "index": 13,
  "name": "Attic Draft",
  "theme": "kitchen",
  "kind": "arcade",
  "seed": 1746741101,
  "width": 15,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.#.#####.###.#",
    "#.....r....~..#",
    "#.............#",
    "#..........r..#",
    "#............o#",
    "###############",
    "###############",
    "###############"
  ],
  "decor": [
    "               ",
    " =*+   .`,=*+  ",
    "  .`,=*+   .`, ",
    " *+   .`,=*+   ",
    " .`,=*+   .`,= ",
    " +      +*     ",
    " `,=*+   .`,=* ",
    "    .`,=*+   . ",
    " ,=*+   .`,=*+ ",
    "   .`,=*+   .` ",
    "               ",
    "++             ",
    " +             "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 9,
      "id": "arcade-13-attic-draft-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 6,
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
      "x": 7,
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
      "type": "cheese",
      "x": 4,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 7,
      "y": 8,
      "breed": "calico",
      "patrol": 1,
      "facing": 6.05
    },
    {
      "type": "cat",
      "x": 2,
      "y": 9,
      "breed": "ragdoll",
      "patrol": 2,
      "facing": 5.13
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 3,
      "kind": "speed"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 4,
      "radius": 4.5,
      "intensity": 0.67,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 2,
      "radius": 4.5,
      "intensity": 0.74,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 8,
      "radius": 4.2,
      "intensity": 0.89,
      "flicker": 0.34,
      "on": true
    },
    {
      "x": 11,
      "y": 1,
      "radius": 6.2,
      "intensity": 0.66,
      "flicker": 0.27,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 0.36,
      "points": [
        {
          "x": 7,
          "y": 8
        },
        {
          "x": 2,
          "y": 9
        },
        {
          "x": 13,
          "y": 3
        },
        {
          "x": 7,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.7,
      "points": [
        {
          "x": 2,
          "y": 9
        },
        {
          "x": 13,
          "y": 3
        },
        {
          "x": 7,
          "y": 4
        },
        {
          "x": 11,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Attic Draft. The oven keeps a second set of books."
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
      "line": "Sneak the oven. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the oven. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in kitchen. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. channels heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Attic Draft banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The oven keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the oven considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 8
      },
      {
        "x": 2,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 7
      },
      {
        "x": 4,
        "y": 6
      },
      {
        "x": 6,
        "y": 8
      },
      {
        "x": 7,
        "y": 9
      }
    ],
    "aggression": 0.75,
    "scentBias": 0.76,
    "hearingBias": 0.67,
    "campHoleChance": 0.29,
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
  "parTime": 129,
  "lives": 3,
  "ambient": 0.62,
  "difficulty": 4.6,
  "music": "kitchen-night",
  "tags": [
    "kitchen",
    "channels",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
