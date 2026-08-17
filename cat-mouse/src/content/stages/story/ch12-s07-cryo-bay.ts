import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s07-cryo-bay",
  "chapter": 12,
  "index": 7,
  "name": "Cryo Bay",
  "theme": "moonLab",
  "kind": "story",
  "seed": 2734227004,
  "width": 23,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.......##............#",
    "#.......##............#",
    "#.....................#",
    "#.......##............#",
    "#.....................#",
    "#.....................#",
    "#.......##............#",
    "#.......##............#",
    "#.......##.........D..#",
    "#.......##............#",
    "#.....................#",
    "#.......##............#",
    "#.......##...G........#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "                       ",
    " *+   .`,=*+   .`,=*+  ",
    " .`,=*+   .`,=*+   .`, ",
    " +   .`,  +   .`,=*+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=     .`,=*+    ",
    " ,=*+   .`,=*+   .`,=* ",
    "   .`,=*+   .`,=*+   . ",
    " =*+   .  =*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`  *+   .`,= +  ",
    " .`,=*+   .`,=*+   .`,+",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+    `,=*+   .`,= ",
    "    .`,=     .`,=*+    ",
    " ,=*+   .`,=*+   .`,=* ",
    "       ++        +     "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 15,
      "id": "ch12-s07-cryo-bay-hole"
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 15,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 15,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 6,
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
      "x": 12,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 6,
      "y": 4,
      "breed": "britishShorthair",
      "patrol": 1,
      "facing": 4.56
    },
    {
      "type": "cat",
      "x": 4,
      "y": 6,
      "breed": "savannah",
      "patrol": 2,
      "facing": 1.93
    },
    {
      "type": "powerUp",
      "x": 2,
      "y": 8,
      "kind": "extraLife"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 10,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 15,
      "kind": "vacuum"
    },
    {
      "type": "decorProp",
      "x": 7,
      "y": 4,
      "note": "airlock"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 5,
      "radius": 4.1,
      "intensity": 0.52,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 2,
      "radius": 3.6,
      "intensity": 0.68,
      "flicker": 0.11,
      "on": true
    },
    {
      "x": 21,
      "y": 5,
      "radius": 3.3,
      "intensity": 0.84,
      "flicker": 0.34,
      "on": true
    },
    {
      "x": 4,
      "y": 9,
      "radius": 5.4,
      "intensity": 0.81,
      "flicker": 0.12,
      "on": true
    },
    {
      "x": 21,
      "y": 15,
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
      "pauseSeconds": 0.45,
      "points": [
        {
          "x": 6,
          "y": 4
        },
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 2,
          "y": 8
        },
        {
          "x": 1,
          "y": 10
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.34,
      "points": [
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 2,
          "y": 8
        },
        {
          "x": 1,
          "y": 10
        },
        {
          "x": 11,
          "y": 15
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Cryo Bay. The cryo keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 9. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the cryo. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the cryo. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in moonLab. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 9. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Cryo Bay banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The cryo keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the cryo considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 14
      },
      {
        "x": 3,
        "y": 15
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 15
      },
      {
        "x": 7,
        "y": 11
      },
      {
        "x": 12,
        "y": 6
      },
      {
        "x": 12,
        "y": 15
      }
    ],
    "aggression": 1,
    "scentBias": 0.44,
    "hearingBias": 0.51,
    "campHoleChance": 0.29,
    "leashRadius": 18
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 9,
      "optional": false,
      "label": "Bank 9 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 9,
  "parTime": 180,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 9.5,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "dual",
    "story",
    "multi-cat",
    "q9"
  ]
};

export default stage;
