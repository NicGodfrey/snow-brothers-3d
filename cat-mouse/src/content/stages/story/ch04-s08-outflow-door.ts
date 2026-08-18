import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s08-outflow-door",
  "chapter": 4,
  "index": 8,
  "name": "Outflow Door",
  "theme": "sewer",
  "kind": "story",
  "seed": 178520994,
  "width": 23,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.....................#",
    "#...........pp........#",
    "#.gggg......pp....g...#",
    "#.gggg......pp...ggp..#",
    "#.........X.pp...ggp..#",
    "#................ggp..#",
    "#.....................#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "  +  +   +             ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   .`,=*+  ",
    " .`,=*+   .`,=*+   .`, ",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,=*+   .`,=*+   .`,=* ",
    "   .`,=*+   .`,=*+   . ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   .`,=*+  ",
    "            +          "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 11,
      "id": "ch04-s08-outflow-door-hole"
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
      "x": 11,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 21,
      "y": 2,
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
      "type": "cheese",
      "x": 7,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 18,
      "y": 6,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 5.66
    },
    {
      "type": "powerUp",
      "x": 10,
      "y": 1,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 9,
      "kind": "water"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 2,
      "note": "pump"
    }
  ],
  "lights": [
    {
      "x": 13,
      "y": 3,
      "radius": 4.6,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 8,
      "y": 8,
      "radius": 6.1,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
      "y": 3,
      "radius": 5.9,
      "intensity": 0.67,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
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
      "loop": false,
      "pauseSeconds": 0.98,
      "points": [
        {
          "x": 18,
          "y": 6
        },
        {
          "x": 10,
          "y": 1
        },
        {
          "x": 11,
          "y": 9
        },
        {
          "x": 1,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Outflow Door. The pump keeps a second set of books."
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
      "line": "Sneak the pump. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pump. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Outflow Door banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pump keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pump considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 10
      },
      {
        "x": 2,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 3
      },
      {
        "x": 11,
        "y": 5
      },
      {
        "x": 16,
        "y": 10
      },
      {
        "x": 6,
        "y": 7
      }
    ],
    "aggression": 0.69,
    "scentBias": 0.51,
    "hearingBias": 0.65,
    "campHoleChance": 0.13,
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
  "parTime": 132,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 4.1,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "islands",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
