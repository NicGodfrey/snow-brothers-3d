import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s07-skydome",
  "chapter": 7,
  "index": 7,
  "name": "Skydome",
  "theme": "museum",
  "kind": "story",
  "seed": 2885952375,
  "width": 23,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.r...................#",
    "#.....................#",
    "#..#...###.###.#####..#",
    "#..#...###.#########..#",
    "#..#...###.#########r.#",
    "#......###.#########..#",
    "#..#...###.#########..#",
    "#..#...###.##.######..#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "  +      +    +        ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   .`,=*+  ",
    " .`,=*+   .`,=*+   .`,+",
    " +   .`   +   .    +   ",
    " `, *+    `  +      ,= ",
    "    .`,         +      ",
    " ,=*+     ,         =*+",
    "    `,=              . ",
    " =*       =         *+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   .`,=*+  ",
    " .`,=*+   .`,=*+   .`, ",
    "               +       "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 12,
      "id": "ch07-s07-skydome-hole"
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 8,
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
      "type": "cheese",
      "x": 8,
      "y": 11,
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
      "x": 4,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 14,
      "y": 4,
      "breed": "russianBlue",
      "patrol": 1,
      "facing": 5.94
    },
    {
      "type": "cat",
      "x": 7,
      "y": 2,
      "breed": "persian",
      "patrol": 2,
      "facing": 0.62
    },
    {
      "type": "powerUp",
      "x": 1,
      "y": 4,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 1,
      "kind": "snapTrap"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 2,
      "radius": 5.1,
      "intensity": 0.82,
      "flicker": 0.29,
      "on": true
    },
    {
      "x": 13,
      "y": 12,
      "radius": 3.2,
      "intensity": 0.52,
      "flicker": 0.22,
      "on": true
    },
    {
      "x": 20,
      "y": 12,
      "radius": 5,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
      "y": 12,
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
      "pauseSeconds": 0.68,
      "points": [
        {
          "x": 14,
          "y": 4
        },
        {
          "x": 7,
          "y": 2
        },
        {
          "x": 1,
          "y": 4
        },
        {
          "x": 10,
          "y": 1
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.77,
      "points": [
        {
          "x": 7,
          "y": 2
        },
        {
          "x": 1,
          "y": 4
        },
        {
          "x": 10,
          "y": 1
        },
        {
          "x": 14,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Skydome. The vault keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 7. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the vault. Dash is postage. The ring layout lies about shortcuts.",
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
      "line": "I heard a verb in museum. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 7. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Skydome banked. Whiskers attached."
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
        "x": 21,
        "y": 11
      },
      {
        "x": 14,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 14,
        "y": 3
      },
      {
        "x": 1,
        "y": 8
      },
      {
        "x": 6,
        "y": 12
      },
      {
        "x": 8,
        "y": 11
      }
    ],
    "aggression": 0.9,
    "scentBias": 0.48,
    "hearingBias": 0.47,
    "campHoleChance": 0.18,
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
  "parTime": 157,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 6,
  "music": "museum-echo",
  "tags": [
    "museum",
    "ring",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
