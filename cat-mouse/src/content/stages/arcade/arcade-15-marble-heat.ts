import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-15-marble-heat",
  "chapter": 0,
  "index": 15,
  "name": "Marble Heat",
  "theme": "alley",
  "kind": "arcade",
  "seed": 1748802138,
  "width": 16,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#.....G.G......#",
    "#..............#",
    "#.XpppG.G......#",
    "#.ppppp.X.XX...#",
    "#.ppppp.X.XX...#",
    "#.ppppp....g...#",
    "#..pppp.G.pp...#",
    "#...GGG.G.pp.g.#",
    "#..............#",
    "#.........pp...#",
    "#..............#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    " +       +      ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`,+",
    " =*+   .`,=*+   ",
    "   `,=*+   .`,= ",
    " *+   .` = =    ",
    " .`,=*+   = ,=* ",
    " +   .`,=*+   . ",
    " `,=*+   .`,=*+ ",
    "    .`,=*+   .` ",
    " ,=*+   .`,=*+  ",
    "   .`,=*+   .`, ",
    " =*+   .`,=*+  +",
    "  .`,=*+   .`,= ",
    "+*+   .`,=*+    ",
    "               +"
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 14,
      "id": "arcade-15-marble-heat-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 13,
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
      "x": 13,
      "y": 10,
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
      "x": 13,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 10,
      "y": 4,
      "breed": "calico",
      "patrol": 1,
      "facing": 5.67
    },
    {
      "type": "cat",
      "x": 11,
      "y": 13,
      "breed": "bombay",
      "patrol": 2,
      "facing": 2.92
    },
    {
      "type": "powerUp",
      "x": 11,
      "y": 9,
      "kind": "speed"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 1,
      "radius": 4.1,
      "intensity": 0.81,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 13,
      "radius": 4.1,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 3,
      "y": 4,
      "radius": 3.8,
      "intensity": 0.73,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 14,
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
      "pauseSeconds": 0.4,
      "points": [
        {
          "x": 10,
          "y": 4
        },
        {
          "x": 11,
          "y": 13
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 11,
          "y": 9
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.52,
      "points": [
        {
          "x": 11,
          "y": 13
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 11,
          "y": 9
        },
        {
          "x": 9,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Marble Heat. The dumpster keeps a second set of books."
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
      "line": "Sneak the dumpster. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the dumpster. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. islands heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Marble Heat banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The dumpster keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the dumpster considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 13
      },
      {
        "x": 9,
        "y": 13
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 13
      },
      {
        "x": 11,
        "y": 3
      },
      {
        "x": 13,
        "y": 10
      },
      {
        "x": 7,
        "y": 9
      }
    ],
    "aggression": 0.74,
    "scentBias": 0.38,
    "hearingBias": 0.75,
    "campHoleChance": 0.26,
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
  "parTime": 135,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 4.8,
  "music": "alley-neon",
  "tags": [
    "alley",
    "islands",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
