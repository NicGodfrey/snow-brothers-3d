import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-11-pendulum-gap",
  "chapter": 0,
  "index": 11,
  "name": "Pendulum Gap",
  "theme": "clocktower",
  "kind": "timeAttack",
  "seed": 3674935278,
  "width": 16,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "################",
    "#..............#",
    "#..............#",
    "#..#####.#.##..#",
    "#..#####.####..#",
    "#..#####.####..#",
    "#..#####.####..#",
    "#..#####.####..#",
    "#...####..###..#",
    "#..............#",
    "#.............o#",
    "################"
  ],
  "decor": [
    "   +     +      ",
    "  .`,=*+   .`,= ",
    " *+   .`,=*+    ",
    " .`      +.  =* ",
    " +      =     . ",
    " `,   +      *+ ",
    "        *    .` ",
    " ,=     .    + +",
    "   .    + +  `, ",
    " =*+   .`,=*+   ",
    "  .`,=*+   .`,= ",
    "     +    +     "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 10,
      "id": "ta-11-pendulum-gap-hole"
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
      "x": 11,
      "y": 2,
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
      "x": 6,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 14,
      "y": 6,
      "breed": "manx",
      "patrol": 1,
      "facing": 5.44
    },
    {
      "type": "powerUp",
      "x": 4,
      "y": 2,
      "kind": "timeSlip"
    },
    {
      "type": "decorProp",
      "x": 2,
      "y": 2,
      "note": "bell"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 3,
      "radius": 4.4,
      "intensity": 0.45,
      "flicker": 0.32,
      "on": true
    },
    {
      "x": 14,
      "y": 7,
      "radius": 4.4,
      "intensity": 0.77,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
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
      "pauseSeconds": 0.58,
      "points": [
        {
          "x": 14,
          "y": 6
        },
        {
          "x": 2,
          "y": 2
        },
        {
          "x": 1,
          "y": 3
        },
        {
          "x": 6,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Pendulum Gap. The bell keeps a second set of books."
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
      "line": "Sneak the bell. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the bell. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Pendulum Gap banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The bell keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the bell considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 9
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
        "x": 11,
        "y": 2
      },
      {
        "x": 10,
        "y": 1
      },
      {
        "x": 6,
        "y": 10
      }
    ],
    "aggression": 0.42,
    "scentBias": 0.39,
    "hearingBias": 0.49,
    "campHoleChance": 0.09,
    "leashRadius": 6
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "timeLimit",
      "value": 98,
      "optional": false,
      "label": "Beat 98s"
    }
  ],
  "quota": 4,
  "parTime": 98,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 2.3,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "ring",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
