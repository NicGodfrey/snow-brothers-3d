import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch02-s06-flooded-sump",
  "chapter": 2,
  "index": 6,
  "name": "Flooded Sump",
  "theme": "cellar",
  "kind": "story",
  "seed": 2358365892,
  "width": 24,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#...................####",
    "#...................####",
    "#....#.~.......#....####",
    "#....#.~..#....#....####",
    "#....#.~..#....#..r.####",
    "#......~..#.........####",
    "#...................####",
    "#....#.~..#....#....####",
    "#..................o####",
    "########################"
  ],
  "decor": [
    "    +        ++        +",
    " ,=*+   .`,=*+   .`,  + ",
    "   .`,=*+   .`,=*+      ",
    "+=*+ + .`,=*+   .`,=    ",
    "  .`, *+   .`,= +       ",
    " *+   .`,= +    `,=*+ + ",
    " .`,=*+    `,=*+   .    ",
    " +   .`,=*+   .`,=*+    ",
    " `,=*+   . ,=*+   .`    ",
    "    .`,=*+   .`,=*+     ",
    "     +                  "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 9,
      "id": "ch02-s06-flooded-sump-hole"
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 7,
      "value": 1,
      "guarded": false
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
      "x": 16,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 12,
      "y": 7,
      "breed": "persian",
      "patrol": 1,
      "facing": 2.11
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 9,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 17,
      "y": 6,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 3,
      "y": 7,
      "note": "furnace"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 9,
      "radius": 4.9,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 7,
      "radius": 4.9,
      "intensity": 0.76,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 7,
      "radius": 3.5,
      "intensity": 0.45,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "pauseSeconds": 1.49,
      "points": [
        {
          "x": 12,
          "y": 7
        },
        {
          "x": 7,
          "y": 9
        },
        {
          "x": 17,
          "y": 6
        },
        {
          "x": 3,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Flooded Sump. The wine rack keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the wine rack. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the wine rack. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in cellar. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Flooded Sump banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The wine rack keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the wine rack considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 8
      },
      {
        "x": 16,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 16,
        "y": 9
      },
      {
        "x": 4,
        "y": 7
      },
      {
        "x": 17,
        "y": 2
      },
      {
        "x": 16,
        "y": 4
      }
    ],
    "aggression": 0.64,
    "scentBias": 0.43,
    "hearingBias": 0.65,
    "campHoleChance": 0.14,
    "leashRadius": 8
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 4,
  "parTime": 120,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 2.4,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "channels",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
