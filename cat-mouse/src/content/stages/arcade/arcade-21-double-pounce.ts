import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-21-double-pounce",
  "chapter": 0,
  "index": 21,
  "name": "Double Pounce",
  "theme": "docks",
  "kind": "arcade",
  "seed": 2986183463,
  "width": 23,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#................L....#",
    "#..............L......#",
    "#.#############.#####.#",
    "#.....................#",
    "#.....................#",
    "#.....................#",
    "#.###########.#######.#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################",
    "#######################",
    "#######################"
  ],
  "decor": [
    "      +                ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .`+",
    " *+   .`,=*+   .`,=*+  ",
    " .             +    +, ",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,           +       *+",
    "   .`,=*+   .`,=*+   . ",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    "       +               ",
    "                       ",
    "           +           "
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
      "id": "arcade-21-double-pounce-hole"
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 3,
      "value": 1,
      "guarded": false
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
      "x": 3,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 18,
      "y": 10,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 0.08
    },
    {
      "type": "cat",
      "x": 14,
      "y": 1,
      "breed": "sphynx",
      "patrol": 2,
      "facing": 3.86
    },
    {
      "type": "powerUp",
      "x": 16,
      "y": 11,
      "kind": "featherFoot"
    },
    {
      "type": "decorProp",
      "x": 21,
      "y": 4,
      "note": "nets"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 7,
      "radius": 4.1,
      "intensity": 0.67,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 3,
      "radius": 4.4,
      "intensity": 0.87,
      "flicker": 0.28,
      "on": true
    },
    {
      "x": 10,
      "y": 7,
      "radius": 5.9,
      "intensity": 0.83,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 2,
      "radius": 5.1,
      "intensity": 0.53,
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
      "pauseSeconds": 0.45,
      "points": [
        {
          "x": 18,
          "y": 10
        },
        {
          "x": 14,
          "y": 1
        },
        {
          "x": 16,
          "y": 11
        },
        {
          "x": 21,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.54,
      "points": [
        {
          "x": 14,
          "y": 1
        },
        {
          "x": 16,
          "y": 11
        },
        {
          "x": 21,
          "y": 4
        },
        {
          "x": 8,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Double Pounce. The pier keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the pier. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pier. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in docks. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. channels heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Double Pounce banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pier keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pier considers creaking.",
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
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 2,
        "y": 11
      },
      {
        "x": 13,
        "y": 1
      },
      {
        "x": 4,
        "y": 3
      },
      {
        "x": 2,
        "y": 3
      }
    ],
    "aggression": 0.67,
    "scentBias": 0.44,
    "hearingBias": 0.57,
    "campHoleChance": 0.22,
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
  "parTime": 144,
  "lives": 3,
  "ambient": 0.32,
  "difficulty": 5.5,
  "music": "docks-foghorn",
  "tags": [
    "docks",
    "channels",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
