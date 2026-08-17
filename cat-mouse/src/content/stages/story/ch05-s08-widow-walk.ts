import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s08-widow-walk",
  "chapter": 5,
  "index": 8,
  "name": "Widow Walk",
  "theme": "attic",
  "kind": "story",
  "seed": 399716073,
  "width": 22,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "######################",
    "#....................#",
    "#....................#",
    "#....................#",
    "#...#.########.###...#",
    "#...#.############...#",
    "#...#.############...#",
    "#.....############...#",
    "#...#.############...#",
    "#...#.############...#",
    "#...#.############...#",
    "#...#.############...#",
    "#.....#####.g#####...#",
    "#....................#",
    "#..........r.........#",
    "#...................o#",
    "######################"
  ],
  "decor": [
    " +                    ",
    "  .`,=*+   .`,=*+   . ",
    " *+   .`,=*+   .`,=*+ ",
    " .`,=*+   .`,=*+   .` ",
    " +   . +      .   *+ +",
    " `,= + +          .`, ",
    "     `            +   ",
    " ,=*+            +`,= ",
    "   . ,           +    ",
    " =*++   +         ,=* ",
    "  .` =              . ",
    " *+     +         =*+ ",
    " .`,=*     `,      .` ",
    " +   .`,=*+   .`,=*+  ",
    " `,=*+   .`,=*+   .`, ",
    "    .`,=*+   .`,=*+   ",
    "          + +         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 20,
      "y": 15,
      "id": "ch05-s08-widow-walk-hole"
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 5,
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
      "type": "cat",
      "x": 12,
      "y": 3,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 2.37
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 2,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 8,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 20,
      "y": 4,
      "kind": "snapTrap"
    }
  ],
  "lights": [
    {
      "x": 18,
      "y": 1,
      "radius": 3.4,
      "intensity": 0.67,
      "flicker": 0,
      "on": true
    },
    {
      "x": 4,
      "y": 7,
      "radius": 3.9,
      "intensity": 0.73,
      "flicker": 0,
      "on": true
    },
    {
      "x": 20,
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
      "loop": false,
      "pauseSeconds": 1.44,
      "points": [
        {
          "x": 12,
          "y": 3
        },
        {
          "x": 3,
          "y": 2
        },
        {
          "x": 3,
          "y": 8
        },
        {
          "x": 20,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Widow Walk. The dormer keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the dormer. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the dormer. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Widow Walk banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The dormer keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the dormer considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 20,
        "y": 14
      },
      {
        "x": 18,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 18,
        "y": 2
      },
      {
        "x": 4,
        "y": 1
      },
      {
        "x": 5,
        "y": 15
      },
      {
        "x": 9,
        "y": 1
      }
    ],
    "aggression": 0.66,
    "scentBias": 0.54,
    "hearingBias": 0.45,
    "campHoleChance": 0.16,
    "leashRadius": 11
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 6,
      "optional": false,
      "label": "Bank 6 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 6,
  "parTime": 147,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4.8,
  "music": "attic-moths",
  "tags": [
    "attic",
    "ring",
    "story",
    "solo-cat",
    "q6"
  ]
};

export default stage;
