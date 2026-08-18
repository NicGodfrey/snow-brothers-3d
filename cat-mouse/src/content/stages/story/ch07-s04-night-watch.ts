import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch07-s04-night-watch",
  "chapter": 7,
  "index": 4,
  "name": "Night Watch",
  "theme": "museum",
  "kind": "story",
  "seed": 4008104229,
  "width": 23,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.#####...#.#####..##.#",
    "#.#...r.....r.......#.#",
    "#.##.....#........###.#",
    "#.....................#",
    "#.#.####.....####.###.#",
    "#.#...#.......#.#..r#.#",
    "#.###.##....#.#.#.#.#.#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "       +               ",
    " +   .`,=*+   .`,=*+   ",
    "+`       . ,      .  = ",
    "    .`,=*+   .`,=*+    ",
    " ,  +   . ,=*+   .   * ",
    "   .`,=*+   .`,=*+   . ",
    " = +    `,=*+    `   + ",
    "   `,= +   .`, *     `+",
    " *    + ,=*+  +. , *   ",
    " .`,=*+   .`,=*+   .`, ",
    "    +       ++         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 9,
      "id": "ch07-s04-night-watch-hole"
    },
    {
      "type": "cheese",
      "x": 8,
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
      "x": 21,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 5,
      "y": 8,
      "breed": "persian",
      "patrol": 1,
      "facing": 5.28
    },
    {
      "type": "cat",
      "x": 8,
      "y": 8,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 5.4
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 6,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 8,
      "kind": "glueBoard"
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 7,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 2,
      "radius": 5.7,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 6,
      "radius": 4.6,
      "intensity": 0.66,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
      "y": 9,
      "radius": 5.8,
      "intensity": 0.46,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 1,
      "radius": 6.1,
      "intensity": 0.61,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
      "y": 9,
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
      "pauseSeconds": 0.58,
      "points": [
        {
          "x": 5,
          "y": 8
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 12,
          "y": 6
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.47,
      "points": [
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 12,
          "y": 6
        },
        {
          "x": 1,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Night Watch. The vault keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the vault. Dash is postage. The maze layout lies about shortcuts.",
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
      "line": "Half of 6. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Night Watch banked. Whiskers attached."
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
        "y": 8
      },
      {
        "x": 8,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 8,
        "y": 5
      },
      {
        "x": 5,
        "y": 1
      },
      {
        "x": 21,
        "y": 5
      },
      {
        "x": 17,
        "y": 9
      }
    ],
    "aggression": 0.78,
    "scentBias": 0.4,
    "hearingBias": 0.7,
    "campHoleChance": 0.25,
    "leashRadius": 13
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
  "parTime": 142,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 5.7,
  "music": "museum-echo",
  "tags": [
    "museum",
    "maze",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
