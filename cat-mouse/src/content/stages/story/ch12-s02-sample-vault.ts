import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s02-sample-vault",
  "chapter": 12,
  "index": 2,
  "name": "Sample Vault",
  "theme": "moonLab",
  "kind": "story",
  "seed": 3794568799,
  "width": 16,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "################",
    "################",
    "##............##",
    "##......##....##",
    "##......##....##",
    "##......##....##",
    "##......##....##",
    "##.##.######..##",
    "##.##.######..##",
    "##............##",
    "##............##",
    "##............##",
    "##......##....##",
    "##......##...o##",
    "################",
    "################"
  ],
  "decor": [
    "        +       ",
    "          +     ",
    "  `,=*+   .`,=  ",
    "     .`,  +    +",
    "  ,=*+   +`,=*  ",
    "    .`,=     .  ",
    "  =*+     ,=*+  ",
    "   + ,     +.`  ",
    "  *   +     +   ",
    "  .`,=*+   .`,  ",
    "  +   .`,=*+    ",
    "+ `,=*+   .`,=  ",
    "     .`,  +     ",
    "  ,=*+    `,=*  ",
    "     +          ",
    "   +           +"
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 13,
      "id": "ch12-s02-sample-vault-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 7,
      "value": 1,
      "guarded": false
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
      "x": 3,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 13,
      "y": 4,
      "breed": "siamese",
      "patrol": 1,
      "facing": 4.47
    },
    {
      "type": "cat",
      "x": 11,
      "y": 2,
      "breed": "britishShorthair",
      "patrol": 2,
      "facing": 0.01
    },
    {
      "type": "powerUp",
      "x": 11,
      "y": 13,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 5,
      "y": 6,
      "kind": "vacuum"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 3,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 9,
      "y": 11,
      "kind": "vacuum"
    }
  ],
  "lights": [
    {
      "x": 12,
      "y": 13,
      "radius": 3.6,
      "intensity": 0.72,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 3,
      "radius": 3.9,
      "intensity": 0.62,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 5,
      "radius": 6.2,
      "intensity": 0.6,
      "flicker": 0,
      "on": true
    },
    {
      "x": 3,
      "y": 11,
      "radius": 3.3,
      "intensity": 0.59,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 1.09,
      "points": [
        {
          "x": 13,
          "y": 4
        },
        {
          "x": 12,
          "y": 13
        },
        {
          "x": 13,
          "y": 12
        },
        {
          "x": 11,
          "y": 2
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.59,
      "points": [
        {
          "x": 11,
          "y": 2
        },
        {
          "x": 12,
          "y": 13
        },
        {
          "x": 13,
          "y": 12
        },
        {
          "x": 5,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Sample Vault. The centrifuge keeps a second set of books."
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
      "line": "Sneak the centrifuge. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the centrifuge. Heavy. Mine until the hole says otherwise."
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
      "line": "Sample Vault banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The centrifuge keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the centrifuge considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 12
      },
      {
        "x": 2,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 4
      },
      {
        "x": 13,
        "y": 10
      },
      {
        "x": 7,
        "y": 3
      },
      {
        "x": 12,
        "y": 7
      }
    ],
    "aggression": 1.08,
    "scentBias": 0.61,
    "hearingBias": 0.76,
    "campHoleChance": 0.24,
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
  "parTime": 159,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 8.9,
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
