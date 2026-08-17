import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch02-s03-root-cellar",
  "chapter": 2,
  "index": 3,
  "name": "Root Cellar",
  "theme": "cellar",
  "kind": "story",
  "seed": 641996317,
  "width": 24,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#......................#",
    "#......................#",
    "#..###############.##..#",
    "#..################.g..#",
    "#..##################..#",
    "#...####.############..#",
    "#......................#",
    "#......................#",
    "#.....................o#",
    "########################"
  ],
  "decor": [
    "            +           ",
    "   .`,=*+   .`,=*+   .` ",
    " =*+   .`,=*+   .`,=*+  ",
    "  .`,=*+   .`,=*+   .`, ",
    " *++              =     ",
    " .`                .`,= ",
    " +                +     ",
    " `,=            +    =* ",
    "    .`,=*+   .`,=*+   . ",
    " ,=*+   .`,=*+   .`,=*+ ",
    "   .`,=*+   .`,=*+   .` ",
    "      +                 "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 10,
      "id": "ch02-s03-root-cellar-hole"
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 9,
      "y": 8,
      "breed": "ragdoll",
      "patrol": 1,
      "facing": 2.87
    },
    {
      "type": "powerUp",
      "x": 4,
      "y": 10,
      "kind": "featherFoot"
    }
  ],
  "lights": [
    {
      "x": 21,
      "y": 3,
      "radius": 5.4,
      "intensity": 0.48,
      "flicker": 0,
      "on": true
    },
    {
      "x": 22,
      "y": 5,
      "radius": 5.1,
      "intensity": 0.47,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
      "y": 3,
      "radius": 4.3,
      "intensity": 0.41,
      "flicker": 0.3,
      "on": true
    },
    {
      "x": 22,
      "y": 10,
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
      "pauseSeconds": 1.67,
      "points": [
        {
          "x": 9,
          "y": 8
        },
        {
          "x": 4,
          "y": 10
        },
        {
          "x": 21,
          "y": 3
        },
        {
          "x": 8,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Root Cellar. The jar wall keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 3. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the jar wall. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the jar wall. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in cellar. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 3. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Root Cellar banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The jar wall keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the jar wall considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 9
      },
      {
        "x": 8,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 8,
        "y": 2
      },
      {
        "x": 20,
        "y": 10
      },
      {
        "x": 1,
        "y": 9
      },
      {
        "x": 14,
        "y": 2
      }
    ],
    "aggression": 0.65,
    "scentBias": 0.77,
    "hearingBias": 0.84,
    "campHoleChance": 0.2,
    "leashRadius": 8
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 3,
      "optional": false,
      "label": "Bank 3 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 3,
  "parTime": 115,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 2.1,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "ring",
    "story",
    "solo-cat",
    "q3"
  ]
};

export default stage;
