import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s05-ferris-shadow",
  "chapter": 6,
  "index": 5,
  "name": "Ferris Shadow",
  "theme": "carnival",
  "kind": "story",
  "seed": 3446233653,
  "width": 20,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "####################",
    "####################",
    "##................##",
    "##................##",
    "##...##....####..###",
    "##...##....####..###",
    "##.........##.....##",
    "##...####..##.....##",
    "##.........##.....##",
    "##...##....##.....##",
    "##r..##...o##.....##",
    "####################",
    "####################"
  ],
  "decor": [
    "                   +",
    "      +   +         ",
    "  ,=*+   .`,=*+    +",
    "    .`,=*+   .`,=*  ",
    "  =*+   .`,         ",
    "   .`  *+      =*   ",
    "+ *+   .`,=     .`  ",
    "  .`,        ,=*+   ",
    "  +   .`,=*    .`,  ",
    "  `,=     .  =*+    ",
    "       ,=*+   .`,=  ",
    "                    ",
    " +                  "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 10,
      "y": 10,
      "id": "ch06-s05-ferris-shadow-hole"
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 2,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 9,
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
      "x": 16,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 16,
      "y": 6,
      "breed": "manx",
      "patrol": 1,
      "facing": 1.57
    },
    {
      "type": "powerUp",
      "x": 14,
      "y": 3,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 3,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 10,
      "kind": "glueBoard"
    }
  ],
  "lights": [
    {
      "x": 9,
      "y": 10,
      "radius": 5.2,
      "intensity": 0.47,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 8,
      "radius": 4.8,
      "intensity": 0.57,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 4,
      "radius": 6,
      "intensity": 0.47,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
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
      "pauseSeconds": 1,
      "points": [
        {
          "x": 16,
          "y": 6
        },
        {
          "x": 9,
          "y": 10
        },
        {
          "x": 14,
          "y": 3
        },
        {
          "x": 10,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Ferris Shadow. The prize tent keeps a second set of books."
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
      "line": "Sneak the prize tent. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the prize tent. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
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
      "line": "Ferris Shadow banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The prize tent keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the prize tent considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 10,
        "y": 9
      },
      {
        "x": 17,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 17,
        "y": 2
      },
      {
        "x": 6,
        "y": 6
      },
      {
        "x": 16,
        "y": 9
      },
      {
        "x": 7,
        "y": 8
      }
    ],
    "aggression": 0.83,
    "scentBias": 0.6,
    "hearingBias": 0.75,
    "campHoleChance": 0.19,
    "leashRadius": 12
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
  "ambient": 0.48,
  "difficulty": 5.1,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "rooms",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
