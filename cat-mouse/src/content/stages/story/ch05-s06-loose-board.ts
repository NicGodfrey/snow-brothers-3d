import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s06-loose-board",
  "chapter": 5,
  "index": 6,
  "name": "Loose Board",
  "theme": "attic",
  "kind": "story",
  "seed": 2896023738,
  "width": 19,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.................#",
    "#..########..######",
    "#.................#",
    "#.................#",
    "#..########.#######",
    "#...r....r........#",
    "#................o#",
    "###################",
    "###################",
    "###################",
    "###################"
  ],
  "decor": [
    "         +   +  + +",
    " +   .`,=*+   .`,= ",
    " `,=*+   .`,=*+    ",
    "      +      +     ",
    " ,=*+   .`,=*+   . ",
    "   .`,=*+   .`,=*+ ",
    " =*        *       ",
    "  .`,=*+   .`,=*+  ",
    " *+   .`,=*+   .`, ",
    "        +      +   ",
    "                   ",
    "              +  + ",
    "                +  "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 8,
      "id": "ch05-s06-loose-board-hole"
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 16,
      "y": 5,
      "breed": "tabby",
      "patrol": 1,
      "facing": 5.01
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 1,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 16,
      "y": 4,
      "kind": "snapTrap"
    },
    {
      "type": "hazard",
      "x": 16,
      "y": 2,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 2,
      "note": "chimney"
    }
  ],
  "lights": [
    {
      "x": 15,
      "y": 8,
      "radius": 5.9,
      "intensity": 0.89,
      "flicker": 0,
      "on": true
    },
    {
      "x": 14,
      "y": 5,
      "radius": 4.6,
      "intensity": 0.58,
      "flicker": 0.22,
      "on": true
    },
    {
      "x": 14,
      "y": 2,
      "radius": 4.2,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "pauseSeconds": 1.46,
      "points": [
        {
          "x": 16,
          "y": 5
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 12,
          "y": 1
        },
        {
          "x": 15,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Loose Board. The chimney keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the chimney. Dash is postage. The channels layout lies about shortcuts.",
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
      "line": "Half of 6. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Loose Board banked. Whiskers attached."
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
        "x": 17,
        "y": 7
      },
      {
        "x": 7,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 7,
        "y": 4
      },
      {
        "x": 17,
        "y": 2
      },
      {
        "x": 10,
        "y": 5
      },
      {
        "x": 5,
        "y": 1
      }
    ],
    "aggression": 0.74,
    "scentBias": 0.69,
    "hearingBias": 0.8,
    "campHoleChance": 0.09,
    "leashRadius": 11
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 6,
      "optional": false,
      "label": "Bank 6 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 6,
  "parTime": 135,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4.5,
  "music": "attic-moths",
  "tags": [
    "attic",
    "channels",
    "story",
    "solo-cat",
    "q6"
  ]
};

export default stage;
