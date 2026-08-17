import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s03-centrifuge",
  "chapter": 12,
  "index": 3,
  "name": "Centrifuge",
  "theme": "moonLab",
  "kind": "story",
  "seed": 293013970,
  "width": 20,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "####################",
    "####################",
    "##................##",
    "##...##.......#...##",
    "##...#####.##.##..##",
    "##..######.##.##..##",
    "##..###.......#...##",
    "##...##.......#...##",
    "##................##",
    "##...##.......#...##",
    "##.#######.##.##.###",
    "##.#######.##.##.###",
    "##................##",
    "##................##",
    "##...............o##",
    "####################",
    "####################"
  ],
  "decor": [
    "                    ",
    "  +                 ",
    " +  .`,=*+   .`,=*  ",
    "++=*+   .`,=*+   .  ",
    "   .`        `  *+  ",
    "  *+ +    =     .`  ",
    "  .`   +   .`, *+   ",
    "  +    `,=*+   .`,  ",
    "  `,=*+   .`,=*+    ",
    "     + ,=*+   +`,=  ",
    "  ,       `  *      ",
    "             .  =   ",
    "  =*+   .`,=*+   . +",
    "   .`,=*+   .`,=*+  ",
    "  *+   .`,=*+   .`+ ",
    "     +          + + ",
    "    +     ++        "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 14,
      "id": "ch12-s03-centrifuge-hole"
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 8,
      "value": 1,
      "guarded": true
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
      "x": 17,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 13,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 16,
      "y": 5,
      "breed": "britishShorthair",
      "patrol": 1,
      "facing": 5.51
    },
    {
      "type": "cat",
      "x": 10,
      "y": 13,
      "breed": "savannah",
      "patrol": 2,
      "facing": 2.33
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 13,
      "kind": "freeze"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 7,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 12,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 10,
      "y": 2,
      "note": "airlock"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 14,
      "radius": 4,
      "intensity": 0.78,
      "flicker": 0,
      "on": true
    },
    {
      "x": 4,
      "y": 3,
      "radius": 4.9,
      "intensity": 0.62,
      "flicker": 0,
      "on": true
    },
    {
      "x": 8,
      "y": 12,
      "radius": 6,
      "intensity": 0.7,
      "flicker": 0.32,
      "on": true
    },
    {
      "x": 17,
      "y": 14,
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
      "pauseSeconds": 1.22,
      "points": [
        {
          "x": 16,
          "y": 5
        },
        {
          "x": 10,
          "y": 13
        },
        {
          "x": 7,
          "y": 13
        },
        {
          "x": 3,
          "y": 7
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.34,
      "points": [
        {
          "x": 10,
          "y": 13
        },
        {
          "x": 7,
          "y": 13
        },
        {
          "x": 3,
          "y": 7
        },
        {
          "x": 2,
          "y": 12
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Centrifuge. The vault keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the vault. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vault. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in moonLab. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. rooms heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Centrifuge banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vault keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vault considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 13
      },
      {
        "x": 13,
        "y": 14
      }
    ],
    "searchSpots": [
      {
        "x": 13,
        "y": 14
      },
      {
        "x": 2,
        "y": 14
      },
      {
        "x": 15,
        "y": 8
      },
      {
        "x": 7,
        "y": 8
      }
    ],
    "aggression": 1.06,
    "scentBias": 0.71,
    "hearingBias": 0.64,
    "campHoleChance": 0.18,
    "leashRadius": 18
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
  "parTime": 167,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 9.1,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "rooms",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
