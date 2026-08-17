import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s06-portrait-gaze",
  "chapter": 7,
  "index": 6,
  "name": "Portrait Gaze",
  "theme": "museum",
  "kind": "story",
  "seed": 1750139786,
  "width": 15,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "###############",
    "###############",
    "##...........##",
    "##.....##....##",
    "##.#.#.##....##",
    "##.#.#.##...G##",
    "##.r.........##",
    "##.....##....##",
    "##...........##",
    "##.....##....##",
    "##...####.#####",
    "##.#.####.##.g#",
    "##.....##....##",
    "##..........o##",
    "###############",
    "###############"
  ],
  "decor": [
    "       +       ",
    "               ",
    "  =*+   .`,=*  ",
    "   .`,=     .  ",
    "  *      ,=*+  ",
    "  . , *    .`++",
    "  +   .`,=*+   ",
    " +`,=*+   .`,  ",
    "     .`,=*+    ",
    "  ,=*+   .`,=  ",
    "    .    +    +",
    "  = +    `  *++",
    "   .`,= +   .  ",
    "  *+   .`,=*+  ",
    "         +     ",
    "+   +          "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 12,
      "y": 13,
      "id": "ch07-s06-portrait-gaze-hole"
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 2,
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
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 3,
      "y": 12,
      "breed": "britishShorthair",
      "patrol": 1,
      "facing": 5.78
    },
    {
      "type": "cat",
      "x": 10,
      "y": 3,
      "breed": "russianBlue",
      "patrol": 2,
      "facing": 2.61
    },
    {
      "type": "powerUp",
      "x": 9,
      "y": 9,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 11,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 12,
      "note": "armor"
    }
  ],
  "lights": [
    {
      "x": 9,
      "y": 7,
      "radius": 4.4,
      "intensity": 0.88,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 3,
      "radius": 5.5,
      "intensity": 0.74,
      "flicker": 0.2,
      "on": true
    },
    {
      "x": 4,
      "y": 11,
      "radius": 4,
      "intensity": 0.43,
      "flicker": 0.15,
      "on": true
    },
    {
      "x": 8,
      "y": 6,
      "radius": 4.9,
      "intensity": 0.46,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
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
      "loop": false,
      "pauseSeconds": 1.63,
      "points": [
        {
          "x": 3,
          "y": 12
        },
        {
          "x": 10,
          "y": 3
        },
        {
          "x": 9,
          "y": 9
        },
        {
          "x": 2,
          "y": 11
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.36,
      "points": [
        {
          "x": 10,
          "y": 3
        },
        {
          "x": 9,
          "y": 9
        },
        {
          "x": 2,
          "y": 11
        },
        {
          "x": 11,
          "y": 12
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Portrait Gaze. The vase keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the vase. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vase. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in museum. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. rooms heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Portrait Gaze banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vase keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vase considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 12,
        "y": 12
      },
      {
        "x": 11,
        "y": 8
      }
    ],
    "searchSpots": [
      {
        "x": 11,
        "y": 8
      },
      {
        "x": 10,
        "y": 2
      },
      {
        "x": 12,
        "y": 2
      },
      {
        "x": 2,
        "y": 12
      }
    ],
    "aggression": 0.77,
    "scentBias": 0.8,
    "hearingBias": 0.57,
    "campHoleChance": 0.25,
    "leashRadius": 13
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 7,
      "optional": false,
      "label": "Bank 7 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 7,
  "parTime": 149,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 5.9,
  "music": "museum-echo",
  "tags": [
    "museum",
    "rooms",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
