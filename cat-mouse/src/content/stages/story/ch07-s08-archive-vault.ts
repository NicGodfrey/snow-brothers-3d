import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s08-archive-vault",
  "chapter": 7,
  "index": 8,
  "name": "Archive Vault",
  "theme": "museum",
  "kind": "story",
  "seed": 2898748350,
  "width": 24,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#...................####",
    "#...................####",
    "#....#....#....#....####",
    "#.........#....#....####",
    "#....#.........#....####",
    "#...................####",
    "#....#....#....#....####",
    "#....#....#....#....####",
    "#..............#....####",
    "#.r..#....#....#....####",
    "#....#....#....#...o####",
    "########################"
  ],
  "decor": [
    "               +        ",
    "  .`,=*+   .`,=*+       ",
    "+*+   .`,=*+   .`,=*  + ",
    " .`,= +    `,=*    .    ",
    " +   .`,=*    . ,=*++   ",
    " `,=*    .`,=*++  .`    ",
    "    .`,=*+   .`,=*+     ",
    "+,=*+   .` =*+   .`,    ",
    "   .` =*+   .`, *+      ",
    " =*+   .`,=*+   .`,=    ",
    "  .`, *+   .`,= +     + ",
    " *+   .`,= +    `,=*    ",
    "         +              "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 11,
      "id": "ch07-s08-archive-vault-hole"
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 13,
      "y": 10,
      "breed": "persian",
      "patrol": 1,
      "facing": 1.47
    },
    {
      "type": "cat",
      "x": 17,
      "y": 1,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 6.24
    },
    {
      "type": "powerUp",
      "x": 14,
      "y": 4,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 3,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 3,
      "y": 8,
      "note": "armor"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 5,
      "radius": 5.5,
      "intensity": 0.89,
      "flicker": 0.17,
      "on": true
    },
    {
      "x": 2,
      "y": 7,
      "radius": 5.7,
      "intensity": 0.88,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "loop": true,
      "pauseSeconds": 1.28,
      "points": [
        {
          "x": 13,
          "y": 10
        },
        {
          "x": 17,
          "y": 1
        },
        {
          "x": 14,
          "y": 4
        },
        {
          "x": 13,
          "y": 3
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.5,
      "points": [
        {
          "x": 17,
          "y": 1
        },
        {
          "x": 14,
          "y": 4
        },
        {
          "x": 13,
          "y": 3
        },
        {
          "x": 3,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Archive Vault. The vault keeps a second set of books."
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
      "line": "Sneak the vault. Dash is postage. The channels layout lies about shortcuts.",
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
      "line": "Half of 7. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Archive Vault banked. Whiskers attached."
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
        "x": 19,
        "y": 10
      },
      {
        "x": 11,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 11,
        "y": 2
      },
      {
        "x": 2,
        "y": 2
      },
      {
        "x": 7,
        "y": 9
      },
      {
        "x": 4,
        "y": 4
      }
    ],
    "aggression": 0.76,
    "scentBias": 0.78,
    "hearingBias": 0.68,
    "campHoleChance": 0.23,
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
  "parTime": 156,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 6.2,
  "music": "museum-echo",
  "tags": [
    "museum",
    "channels",
    "story",
    "multi-cat",
    "q7"
  ]
};

export default stage;
