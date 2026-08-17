import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s08-rooftop-leap",
  "chapter": 3,
  "index": 8,
  "name": "Rooftop Leap",
  "theme": "alley",
  "kind": "story",
  "seed": 2147683683,
  "width": 17,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#..X.......X....#",
    "#...............#",
    "#..##.#.#########",
    "#...............#",
    "#...G....X......#",
    "#...............#",
    "#..##.##.########",
    "#...............#",
    "#....p...X...p..#",
    "#...............#",
    "#...............#",
    "#..............o#",
    "#################"
  ],
  "decor": [
    "                 ",
    " +   .`,=*+   .` ",
    " `, *+   .` =*+  ",
    "    .`,=*+   .`, ",
    "+,=              ",
    "   .`,=*+   .`,= ",
    " =*+   .` =*+    ",
    "  .`,=*+   .`,=* ",
    " *++    ,        ",
    " .`,=*+   .`,=*+ ",
    "++   .`,==+   .` ",
    " `,=*+   .`,=*+  ",
    "    .`,=*+   .`, ",
    " ,=*+   .`,=*+   ",
    "+                "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 13,
      "id": "ch03-s08-rooftop-leap-hole"
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 1,
      "y": 11,
      "breed": "calico",
      "patrol": 1,
      "facing": 5.51
    },
    {
      "type": "powerUp",
      "x": 11,
      "y": 6,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 2,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 13,
      "y": 12,
      "note": "loading dock"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 5,
      "radius": 4.1,
      "intensity": 0.84,
      "flicker": 0.26,
      "on": true
    },
    {
      "x": 10,
      "y": 6,
      "radius": 4.7,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 7,
      "radius": 3.9,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 13,
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
      "pauseSeconds": 0.84,
      "points": [
        {
          "x": 1,
          "y": 11
        },
        {
          "x": 11,
          "y": 6
        },
        {
          "x": 8,
          "y": 2
        },
        {
          "x": 13,
          "y": 12
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Rooftop Leap. The fire escape keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the fire escape. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the fire escape. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Rooftop Leap banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The fire escape keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the fire escape considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 12
      },
      {
        "x": 10,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 10,
        "y": 2
      },
      {
        "x": 2,
        "y": 11
      },
      {
        "x": 7,
        "y": 5
      },
      {
        "x": 1,
        "y": 10
      }
    ],
    "aggression": 0.58,
    "scentBias": 0.42,
    "hearingBias": 0.71,
    "campHoleChance": 0.09,
    "leashRadius": 9
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
  "parTime": 128,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 3.4,
  "music": "alley-neon",
  "tags": [
    "alley",
    "galleries",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
