import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s04-echo-tunnel",
  "chapter": 4,
  "index": 4,
  "name": "Echo Tunnel",
  "theme": "sewer",
  "kind": "story",
  "seed": 3092243041,
  "width": 20,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#..................#",
    "#.....gggggXXX.....#",
    "#.....gggggXXX.....#",
    "#.........g........#",
    "#........g.....pp..#",
    "#........XX....pp..#",
    "#........XX........#",
    "#..................#",
    "#.................o#",
    "####################"
  ],
  "decor": [
    "              ++    ",
    "   .`,=*+   .`,=*+  ",
    " =*+   .`,=     .`, ",
    "  .`,=*+     ==*+   ",
    " *+   .`,=*+   .`,= ",
    " .`,=*+   .`,=*+    ",
    " +   .`,==    .`,=* ",
    " `,=*+   = ,=*+   . ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .`+",
    "+           +       "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 9,
      "id": "ch04-s04-echo-tunnel-hole"
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
      "x": 4,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 4,
      "y": 3,
      "breed": "sphynx",
      "patrol": 1,
      "facing": 3.13
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 8,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 6,
      "kind": "water"
    },
    {
      "type": "decorProp",
      "x": 2,
      "y": 1,
      "note": "overflow"
    }
  ],
  "lights": [
    {
      "x": 17,
      "y": 6,
      "radius": 5.7,
      "intensity": 0.89,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 8,
      "radius": 4.7,
      "intensity": 0.66,
      "flicker": 0.24,
      "on": true
    },
    {
      "x": 7,
      "y": 6,
      "radius": 4.1,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
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
      "pauseSeconds": 0.74,
      "points": [
        {
          "x": 4,
          "y": 3
        },
        {
          "x": 2,
          "y": 1
        },
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 11,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Echo Tunnel. The grate well keeps a second set of books."
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
      "line": "Sneak the grate well. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the grate well. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Echo Tunnel banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The grate well keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the grate well considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 18,
        "y": 8
      },
      {
        "x": 4,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 4,
        "y": 2
      },
      {
        "x": 4,
        "y": 6
      },
      {
        "x": 16,
        "y": 3
      },
      {
        "x": 9,
        "y": 4
      }
    ],
    "aggression": 0.74,
    "scentBias": 0.52,
    "hearingBias": 0.55,
    "campHoleChance": 0.07,
    "leashRadius": 10
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
  "parTime": 116,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 3.6,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "islands",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
