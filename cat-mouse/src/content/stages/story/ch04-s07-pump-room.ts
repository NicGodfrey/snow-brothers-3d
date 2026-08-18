import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s07-pump-room",
  "chapter": 4,
  "index": 7,
  "name": "Pump Room",
  "theme": "sewer",
  "kind": "story",
  "seed": 3145323723,
  "width": 20,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#.................##",
    "#.###.##......###.##",
    "#.....#.......#...##",
    "#.#####.......###.##",
    "#.#...#.#.......p.##",
    "#.#.#.#.#.......#.##",
    "#.........p.....#.##",
    "#.................##",
    "#.#.#.#...#.....#.##",
    "#.#.#.#p......###.##",
    "#...#...#.....#.g.##",
    "#.............###.##",
    "#................o##",
    "####################",
    "####################"
  ],
  "decor": [
    "          +   +     ",
    " ,=*+   .`,=*+   .  ",
    "     ,  +   .`   +  ",
    " =*+   .`,=*+   .`  ",
    "  +    +   .`,      ",
    " *     ` =*+   .`,  ",
    " . , *    .`,=*+    ",
    " +   .`,=*+   .` =+ ",
    " `,=*+   .`,=*+     ",
    "     ` =*++  .`, * +",
    " , *  + .`,=*+   .  ",
    "   . ,=*    .` =*+ +",
    " =*+   .`,=*+    `  ",
    "  .`,=*+   .`,=*+   ",
    "                    ",
    "       +    +   +   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 13,
      "id": "ch04-s07-pump-room-hole"
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
      "x": 8,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 7,
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
      "x": 17,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 9,
      "y": 11,
      "breed": "manx",
      "patrol": 1,
      "facing": 3.22
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 1,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 7,
      "y": 7,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 1,
      "radius": 4.7,
      "intensity": 0.73,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 11,
      "radius": 4,
      "intensity": 0.65,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "loop": true,
      "pauseSeconds": 1.33,
      "points": [
        {
          "x": 9,
          "y": 11
        },
        {
          "x": 12,
          "y": 1
        },
        {
          "x": 3,
          "y": 1
        },
        {
          "x": 7,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Pump Room. The grate well keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the grate well. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the grate well. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Pump Room banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The grate well keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the grate well considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 12
      },
      {
        "x": 9,
        "y": 12
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 12
      },
      {
        "x": 8,
        "y": 8
      },
      {
        "x": 14,
        "y": 13
      },
      {
        "x": 13,
        "y": 3
      }
    ],
    "aggression": 0.7,
    "scentBias": 0.36,
    "hearingBias": 0.38,
    "campHoleChance": 0.12,
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
  "parTime": 134,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 3.9,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "maze",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
