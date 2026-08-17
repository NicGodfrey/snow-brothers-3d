import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s04-hatbox-stack",
  "chapter": 5,
  "index": 4,
  "name": "Hatbox Stack",
  "theme": "attic",
  "kind": "story",
  "seed": 3198697314,
  "width": 17,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#################",
    "##.............##",
    "##.............##",
    "##.............##",
    "##........r..r.##",
    "##.............##",
    "##.............##",
    "##............o##",
    "#################",
    "#################"
  ],
  "decor": [
    "                 ",
    "                 ",
    "   .`,=*+   .`,+ ",
    "  *+   .`,=*+    ",
    "  .`,=*+   .`,=  ",
    "  +   .`,=*+     ",
    "  `,=*+   .`,=*  ",
    "     .`,=*+   .  ",
    "+ ,=*+   .`,=*+  ",
    "                 ",
    "+                "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 14,
      "y": 8,
      "id": "ch05-s04-hatbox-stack-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 13,
      "y": 3,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 4.18
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 8,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 3,
      "kind": "broom"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 5,
      "kind": "glueBoard"
    }
  ],
  "lights": [
    {
      "x": 13,
      "y": 8,
      "radius": 5.7,
      "intensity": 0.67,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 8,
      "radius": 3.6,
      "intensity": 0.57,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 8,
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
      "pauseSeconds": 0.87,
      "points": [
        {
          "x": 13,
          "y": 3
        },
        {
          "x": 13,
          "y": 8
        },
        {
          "x": 9,
          "y": 3
        },
        {
          "x": 13,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Hatbox Stack. The chimney keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the chimney. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the chimney. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. rooms heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Hatbox Stack banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The chimney keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the chimney considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 14,
        "y": 7
      },
      {
        "x": 9,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 2
      },
      {
        "x": 11,
        "y": 4
      },
      {
        "x": 14,
        "y": 3
      },
      {
        "x": 13,
        "y": 6
      }
    ],
    "aggression": 0.65,
    "scentBias": 0.48,
    "hearingBias": 0.59,
    "campHoleChance": 0.08,
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
  "parTime": 121,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4.3,
  "music": "attic-moths",
  "tags": [
    "attic",
    "rooms",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
