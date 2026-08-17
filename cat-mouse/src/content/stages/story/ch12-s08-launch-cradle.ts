import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s08-launch-cradle",
  "chapter": 12,
  "index": 8,
  "name": "Launch Cradle",
  "theme": "moonLab",
  "kind": "story",
  "seed": 525159905,
  "width": 20,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#.................##",
    "#...#.###.#.###.#.##",
    "#.............G.#.##",
    "#.#.###.#.#.###.#.##",
    "#.D.#...#.G.....#.##",
    "#.#.r.###.#.#...G..#",
    "#.#................#",
    "#.................o#",
    "#...#.............##",
    "####################",
    "####################"
  ],
  "decor": [
    "                  + ",
    " =*+   .`,=*+   .`  ",
    "+ .` =     .   *    ",
    " *+   .`,=*+   . ,  ",
    " . ,       `   ++   ",
    "++   .`, *+   .` =  ",
    " `+=*+   . , *+   . ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .` ",
    "   . ,=*+   .`,=*+  ",
    "                  + ",
    "+           +  +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 8,
      "id": "ch12-s08-launch-cradle-hole"
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 3,
      "value": 1,
      "guarded": true
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
      "x": 7,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 5,
      "value": 1,
      "guarded": true
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
      "x": 9,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 14,
      "y": 3,
      "breed": "savannah",
      "patrol": 1,
      "facing": 0.93
    },
    {
      "type": "cat",
      "x": 6,
      "y": 1,
      "breed": "bengal",
      "patrol": 2,
      "facing": 1.27
    },
    {
      "type": "powerUp",
      "x": 14,
      "y": 7,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 2,
      "kind": "vacuum"
    },
    {
      "type": "key",
      "x": 18,
      "y": 6,
      "keyId": "ch12-s08-launch-cradle-key"
    },
    {
      "type": "door",
      "x": 2,
      "y": 5,
      "id": "ch12-s08-launch-cradle-door",
      "locked": true,
      "keyId": "ch12-s08-launch-cradle-key"
    }
  ],
  "lights": [
    {
      "x": 16,
      "y": 8,
      "radius": 5.2,
      "intensity": 0.59,
      "flicker": 0.17,
      "on": true
    },
    {
      "x": 3,
      "y": 3,
      "radius": 6,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
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
      "pauseSeconds": 0.68,
      "points": [
        {
          "x": 14,
          "y": 3
        },
        {
          "x": 16,
          "y": 8
        },
        {
          "x": 6,
          "y": 1
        },
        {
          "x": 11,
          "y": 2
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.65,
      "points": [
        {
          "x": 6,
          "y": 1
        },
        {
          "x": 16,
          "y": 8
        },
        {
          "x": 11,
          "y": 2
        },
        {
          "x": 14,
          "y": 7
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Launch Cradle. The cryo keeps a second set of books."
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
      "line": "Sneak the cryo. Dash is postage. The maze layout lies about shortcuts.",
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
      "line": "Half of 9. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Launch Cradle banked. Whiskers attached."
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
        "x": 18,
        "y": 7
      },
      {
        "x": 11,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 11,
        "y": 7
      },
      {
        "x": 17,
        "y": 7
      },
      {
        "x": 10,
        "y": 1
      },
      {
        "x": 15,
        "y": 8
      }
    ],
    "aggression": 1.01,
    "scentBias": 0.61,
    "hearingBias": 0.79,
    "campHoleChance": 0.17,
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
  "parTime": 165,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 9.7,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "maze",
    "story",
    "multi-cat",
    "q9"
  ]
};

export default stage;
