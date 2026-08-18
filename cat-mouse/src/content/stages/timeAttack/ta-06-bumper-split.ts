import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-06-bumper-split",
  "chapter": 0,
  "index": 6,
  "name": "Bumper Split",
  "theme": "carnival",
  "kind": "timeAttack",
  "seed": 2027264642,
  "width": 17,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "#################",
    "#...............#",
    "#...#.#.#.###.###",
    "#...#.#.#...#...#",
    "#.#.#.#.###.#.#.#",
    "#.....#.........#",
    "#.#.....r.......#",
    "#.....r.....r...#",
    "#.##......#.#.#.#",
    "#..............o#",
    "#################",
    "#################"
  ],
  "decor": [
    "    +  +  +      ",
    " .`,=*+   .`,=*+ ",
    "++   . , *       ",
    " `,= +   .`, *+  ",
    "     ` =     . , ",
    " ,=*+   .`,=*+   ",
    "   .`,=*+   .`,= ",
    " =*+   .`,=*+    ",
    "  + ,=*+   . , * ",
    " *+   .`,=*+   . ",
    "+       +        ",
    "     +  +        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 9,
      "id": "ta-06-bumper-split-hole"
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 5,
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
      "x": 2,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 15,
      "y": 3,
      "breed": "calico",
      "patrol": 1,
      "facing": 4.63
    },
    {
      "type": "decorProp",
      "x": 13,
      "y": 8,
      "note": "mirrors"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 5,
      "radius": 4,
      "intensity": 0.57,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 8,
      "radius": 4.3,
      "intensity": 0.45,
      "flicker": 0.19,
      "on": true
    },
    {
      "x": 3,
      "y": 2,
      "radius": 3.5,
      "intensity": 0.71,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
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
      "pauseSeconds": 0.53,
      "points": [
        {
          "x": 15,
          "y": 3
        },
        {
          "x": 13,
          "y": 8
        },
        {
          "x": 8,
          "y": 5
        },
        {
          "x": 5,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Bumper Split. The mirrors keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the mirrors. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the mirrors. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Bumper Split banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The mirrors keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the mirrors considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 8
      },
      {
        "x": 3,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 5
      },
      {
        "x": 13,
        "y": 9
      },
      {
        "x": 2,
        "y": 2
      },
      {
        "x": 7,
        "y": 7
      }
    ],
    "aggression": 0.42,
    "scentBias": 0.5,
    "hearingBias": 0.51,
    "campHoleChance": 0.1,
    "leashRadius": 6
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "timeLimit",
      "value": 99,
      "optional": false,
      "label": "Beat 99s"
    }
  ],
  "quota": 4,
  "parTime": 99,
  "lives": 2,
  "ambient": 0.48,
  "difficulty": 1.7,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "maze",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
