import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch09-s06-gangway",
  "chapter": 9,
  "index": 6,
  "name": "Gangway",
  "theme": "docks",
  "kind": "story",
  "seed": 3009707315,
  "width": 24,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#......................#",
    "#..XXpppp.......L......#",
    "#......................#",
    "#..XppppLL.pppp........#",
    "#......................#",
    "#..XppppLL.............#",
    "#..XX..................#",
    "#......................#",
    "#............XXL.......#",
    "#............XXL.......#",
    "#......................#",
    "#.....................o#",
    "########################"
  ],
  "decor": [
    "        +               ",
    " .`,=*+   .`,=*+   .`,= ",
    " +   .`,=*+   .`,=*+    ",
    " `, =+   .`,=*+   .`,=* ",
    "    .`,=*+   .`,=*+   . ",
    " ,= +   .`,=*+   .`,=*+ ",
    "   .`,=*+   .`,=*+   .` ",
    " =*=   .`,=*+   .`,=*+  ",
    "  . ==*+   .`,=*+   .`, ",
    " *+   .`,=*+   .`,=*+   ",
    " .`,=*+   .`,  +   .`,= ",
    "++   .`,=*+   =`,=*+    ",
    " `,=*+   .`,=*+   .`,=* ",
    "    .`,=*+   .`,=*+   . ",
    "                        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 13,
      "id": "ch09-s06-gangway-hole"
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 6,
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
      "x": 15,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 6,
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
      "type": "cat",
      "x": 18,
      "y": 6,
      "breed": "tabby",
      "patrol": 1,
      "facing": 3.57
    },
    {
      "type": "cat",
      "x": 22,
      "y": 2,
      "breed": "norwegianForest",
      "patrol": 2,
      "facing": 2.57
    },
    {
      "type": "powerUp",
      "x": 18,
      "y": 4,
      "kind": "magnet"
    },
    {
      "type": "hazard",
      "x": 18,
      "y": 5,
      "kind": "water"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 13,
      "radius": 4.2,
      "intensity": 0.47,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
      "y": 13,
      "radius": 5.3,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
      "y": 2,
      "radius": 6,
      "intensity": 0.46,
      "flicker": 0.23,
      "on": true
    },
    {
      "x": 22,
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
      "pauseSeconds": 0.88,
      "points": [
        {
          "x": 18,
          "y": 6
        },
        {
          "x": 22,
          "y": 2
        },
        {
          "x": 18,
          "y": 4
        },
        {
          "x": 3,
          "y": 13
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.55,
      "points": [
        {
          "x": 22,
          "y": 2
        },
        {
          "x": 18,
          "y": 5
        },
        {
          "x": 3,
          "y": 13
        },
        {
          "x": 21,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Gangway. The gangway keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the gangway. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the gangway. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Gangway banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The gangway keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the gangway considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 12
      },
      {
        "x": 5,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 5,
        "y": 11
      },
      {
        "x": 13,
        "y": 2
      },
      {
        "x": 17,
        "y": 6
      },
      {
        "x": 19,
        "y": 9
      }
    ],
    "aggression": 0.86,
    "scentBias": 0.58,
    "hearingBias": 0.65,
    "campHoleChance": 0.19,
    "leashRadius": 15
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 8,
      "optional": false,
      "label": "Bank 8 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 8,
  "parTime": 169,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 7.3,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "islands",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
