import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-17-fog-pileup",
  "chapter": 0,
  "index": 17,
  "name": "Fog Pileup",
  "theme": "attic",
  "kind": "arcade",
  "seed": 2239345636,
  "width": 15,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#...######....#",
    "#...#######...#",
    "#....######...#",
    "#...#######...#",
    "#...#######...#",
    "#...#######...#",
    "#...###.###...#",
    "#.............#",
    "#............o#",
    "###############"
  ],
  "decor": [
    "    +          ",
    "+`,=*+   .`,=* ",
    "    .`,=*+   . ",
    " ,=*      ,=*+ ",
    "   .        .` ",
    " =*+       *+  ",
    "  .`       .`, ",
    " *+        +   ",
    " .`,    +  `,= ",
    " +     ,       ",
    " `,=*+   .`,=* ",
    "    .`,=*+   . ",
    "            +  "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 11,
      "id": "arcade-17-fog-pileup-hole"
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 6,
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
      "type": "cat",
      "x": 6,
      "y": 2,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 0.18
    },
    {
      "type": "cat",
      "x": 11,
      "y": 3,
      "breed": "russianBlue",
      "patrol": 2,
      "facing": 3.06
    },
    {
      "type": "powerUp",
      "x": 2,
      "y": 3,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 5,
      "y": 2,
      "kind": "broom"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 2,
      "radius": 3.2,
      "intensity": 0.83,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 7,
      "y": 2,
      "radius": 4.9,
      "intensity": 0.59,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 5,
      "y": 10,
      "radius": 5.1,
      "intensity": 0.52,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "loop": true,
      "pauseSeconds": 0.47,
      "points": [
        {
          "x": 6,
          "y": 2
        },
        {
          "x": 2,
          "y": 3
        },
        {
          "x": 11,
          "y": 3
        },
        {
          "x": 13,
          "y": 9
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.18,
      "points": [
        {
          "x": 11,
          "y": 3
        },
        {
          "x": 2,
          "y": 3
        },
        {
          "x": 5,
          "y": 2
        },
        {
          "x": 13,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Fog Pileup. The chimney keeps a second set of books."
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
      "line": "Sneak the chimney. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the chimney. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. ring heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Fog Pileup banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The chimney keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the chimney considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 10
      },
      {
        "x": 13,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 13,
        "y": 7
      },
      {
        "x": 4,
        "y": 2
      },
      {
        "x": 3,
        "y": 5
      },
      {
        "x": 1,
        "y": 11
      }
    ],
    "aggression": 0.7,
    "scentBias": 0.58,
    "hearingBias": 0.39,
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
  "parTime": 129,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 5,
  "music": "attic-moths",
  "tags": [
    "attic",
    "ring",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
