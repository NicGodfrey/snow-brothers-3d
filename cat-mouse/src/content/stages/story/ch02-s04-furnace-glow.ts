import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch02-s04-furnace-glow",
  "chapter": 2,
  "index": 4,
  "name": "Furnace Glow",
  "theme": "cellar",
  "kind": "story",
  "seed": 3943577131,
  "width": 23,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#.#####.###.#.#.#.#####",
    "#.......#...#.#.#.....#",
    "#.###r....###.#.#####.#",
    "#...#.....#...#T...T#.#",
    "#.#......r#.#####.###.#",
    "#.#.............#.#...#",
    "#.#........####.###.#.#",
    "#...#...............#.#",
    "#.#.#####......######.#",
    "#....................o#",
    "#######################",
    "#######################"
  ],
  "decor": [
    " +          +          ",
    " `,=*+   .`,=*+   .`,= ",
    "    +  =  +  . , *     ",
    " ,=*+    `,= +   .`,=* ",
    "     ,=*+    ` =     . ",
    " =*+   .`, *+   .`,= ++",
    "   `,=*+   .         ` ",
    " *    .`,=*+   . , *+  ",
    " . ,=*+   .    +   . , ",
    " +   .`,=*+   .`,=*+   ",
    " ` =     .`,=*++ +   = ",
    "+   .`,=*+   .`,=*+    ",
    "               +       ",
    "          +       +    "
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
      "id": "ch02-s04-furnace-glow-hole"
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 15,
      "y": 7,
      "breed": "tabby",
      "patrol": 1,
      "facing": 4.73
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 2,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 1,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 8,
      "radius": 5.3,
      "intensity": 0.78,
      "flicker": 0,
      "on": true
    },
    {
      "x": 8,
      "y": 9,
      "radius": 3.4,
      "intensity": 0.41,
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
      "pauseSeconds": 0.39,
      "points": [
        {
          "x": 15,
          "y": 7
        },
        {
          "x": 7,
          "y": 2
        },
        {
          "x": 12,
          "y": 1
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
      "line": "Furnace Glow. The furnace keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 3. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the furnace. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the furnace. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in cellar. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 3. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Furnace Glow banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The furnace keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the furnace considers creaking.",
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
        "x": 15,
        "y": 2
      }
    ],
    "searchSpots": [
      {
        "x": 15,
        "y": 2
      },
      {
        "x": 16,
        "y": 1
      },
      {
        "x": 13,
        "y": 5
      },
      {
        "x": 1,
        "y": 4
      }
    ],
    "aggression": 0.51,
    "scentBias": 0.71,
    "hearingBias": 0.8,
    "campHoleChance": 0.13,
    "leashRadius": 8
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 3,
      "optional": false,
      "label": "Bank 3 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 3,
  "parTime": 118,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 2.2,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "maze",
    "story",
    "solo-cat",
    "q3"
  ]
};

export default stage;
