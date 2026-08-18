import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch02-s05-jar-shelf",
  "chapter": 2,
  "index": 5,
  "name": "Jar Shelf",
  "theme": "cellar",
  "kind": "story",
  "seed": 3363314489,
  "width": 23,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#..X...s...X...s...T..#",
    "#.....................#",
    "#.##.#########..#.###.#",
    "#.....................#",
    "#...T....X....X....X..#",
    "#.....................#",
    "#.##.###..#######.###.#",
    "#.....................#",
    "#....T...T...s........#",
    "#.....................#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "                       ",
    " .`,=*+   .`,=*+   .`, ",
    " + = .`,=*+   .`,=*    ",
    " `,=*+   .`,=*+   .`,= ",
    "    .         `, *     ",
    " ,=*+   .`,=*+   .`,=*+",
    "   .=,=*+   .` =*+   . ",
    " =*+   .`,=*+   .`,=*+ ",
    "    ,         +      ` ",
    " *+   .`,=*+   .`,=*+ +",
    " .`,= +   .`,=*+   .`,+",
    "++   .`,=*+   .`,=*+   ",
    " `,=*+   .`,=*+   .`,= ",
    "    .`,=*+   .`,=*+    ",
    " ,=*+   .`,=*+   .`,=*+",
    "          +            "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 14,
      "id": "ch02-s05-jar-shelf-hole"
    },
    {
      "type": "cheese",
      "x": 21,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 2,
      "y": 6,
      "breed": "britishShorthair",
      "patrol": 1,
      "facing": 1.78
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 14,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 13,
      "kind": "glueBoard"
    }
  ],
  "lights": [
    {
      "x": 16,
      "y": 9,
      "radius": 5.8,
      "intensity": 0.52,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 5,
      "radius": 4.5,
      "intensity": 0.88,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
      "y": 14,
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
      "pauseSeconds": 1.18,
      "points": [
        {
          "x": 2,
          "y": 6
        },
        {
          "x": 12,
          "y": 14
        },
        {
          "x": 15,
          "y": 13
        },
        {
          "x": 16,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Jar Shelf. The furnace keeps a second set of books."
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
      "line": "Sneak the furnace. Dash is postage. The galleries layout lies about shortcuts.",
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
      "line": "Half of 3. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Jar Shelf banked. Whiskers attached."
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
        "y": 13
      },
      {
        "x": 21,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 21,
        "y": 3
      },
      {
        "x": 13,
        "y": 12
      },
      {
        "x": 14,
        "y": 5
      },
      {
        "x": 17,
        "y": 13
      }
    ],
    "aggression": 0.58,
    "scentBias": 0.59,
    "hearingBias": 0.68,
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
  "parTime": 123,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 2.3,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "galleries",
    "story",
    "solo-cat",
    "q3"
  ]
};

export default stage;
