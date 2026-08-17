import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s02-insulation-sea",
  "chapter": 5,
  "index": 2,
  "name": "Insulation Sea",
  "theme": "attic",
  "kind": "story",
  "seed": 267997333,
  "width": 19,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.XL.LL.XX........#",
    "#.XL.LL.XXvv......#",
    "#.XL.LLXXXXv......#",
    "#.XL.LLXXvvv.r....#",
    "#.XX.XXXXvvvv.r...#",
    "#.XX.XXXXXX.......#",
    "#.................#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "                   ",
    " *+   .`,=*+   .`, ",
    " .=,=*+   .`,=*+   ",
    " +   .`, =+   .`,= ",
    " ` =*+     ,=*+    ",
    "    .`,= +   .`,=* ",
    " ,==+=   `,=*+   . ",
    "   =` =     .`,=*+ ",
    " =*+   .`,=*+   .` ",
    "  .`,=*+   .`,=*+  ",
    "++       +         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 9,
      "id": "ch05-s02-insulation-sea-hole"
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 6,
      "y": 2,
      "breed": "tabby",
      "patrol": 1,
      "facing": 2.89
    },
    {
      "type": "powerUp",
      "x": 6,
      "y": 9,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 4,
      "kind": "broom"
    },
    {
      "type": "decorProp",
      "x": 17,
      "y": 8,
      "note": "hatbox"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 1,
      "radius": 3.8,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 5,
      "radius": 4,
      "intensity": 0.58,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "pauseSeconds": 1.36,
      "points": [
        {
          "x": 6,
          "y": 2
        },
        {
          "x": 17,
          "y": 8
        },
        {
          "x": 6,
          "y": 9
        },
        {
          "x": 13,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Insulation Sea. The trunk keeps a second set of books."
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
      "line": "Sneak the trunk. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the trunk. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
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
      "line": "Insulation Sea banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The trunk keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the trunk considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 8
      },
      {
        "x": 4,
        "y": 8
      }
    ],
    "searchSpots": [
      {
        "x": 4,
        "y": 8
      },
      {
        "x": 12,
        "y": 5
      },
      {
        "x": 14,
        "y": 1
      },
      {
        "x": 7,
        "y": 8
      }
    ],
    "aggression": 0.68,
    "scentBias": 0.36,
    "hearingBias": 0.51,
    "campHoleChance": 0.1,
    "leashRadius": 11
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
  "parTime": 123,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4,
  "music": "attic-moths",
  "tags": [
    "attic",
    "islands",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
