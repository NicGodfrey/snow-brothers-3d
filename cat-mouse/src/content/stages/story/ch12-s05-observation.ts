import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s05-observation",
  "chapter": 12,
  "index": 5,
  "name": "Observation",
  "theme": "moonLab",
  "kind": "story",
  "seed": 429934224,
  "width": 24,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#.....................##",
    "#.#..####.#.###.###.#.##",
    "#.#...D.#.#...#...#...##",
    "#.##...##.#####....##.##",
    "#.....................##",
    "#..................##.##",
    "#.#...#.........#..G..##",
    "#D#..#.....##...#.###.##",
    "#.............#.#.#...##",
    "#.##.##########.#.###.##",
    "#...............#....o##",
    "########################"
  ],
  "decor": [
    "               +        ",
    " +   .`,=*+   .`,=*+    ",
    " ` =*    . ,      +`+=  ",
    "    .` = +   . ,=*      ",
    "+,  +   +`       .`  *+ ",
    "+  .`,=*+   .`,=*+   .  ",
    " =*+   .`,=*+   .`,  +  ",
    "   `,= +   .`,=*    .`  ",
    "  +   .`,=*    . ,      ",
    " .`,=*+   .`,= +   .`,  ",
    "++             ` =    + ",
    " `,=*+   .`,=*+   .`,=  ",
    "              +         "
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
      "id": "ch12-s05-observation-hole"
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 6,
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
      "type": "cheese",
      "x": 21,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 13,
      "y": 5,
      "breed": "bengal",
      "patrol": 1,
      "facing": 5.3
    },
    {
      "type": "cat",
      "x": 3,
      "y": 7,
      "breed": "siamese",
      "patrol": 2,
      "facing": 3.81
    },
    {
      "type": "powerUp",
      "x": 9,
      "y": 11,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 18,
      "y": 4,
      "kind": "vacuum"
    },
    {
      "type": "key",
      "x": 1,
      "y": 6,
      "keyId": "ch12-s05-observation-key"
    },
    {
      "type": "door",
      "x": 1,
      "y": 8,
      "id": "ch12-s05-observation-door",
      "locked": true,
      "keyId": "ch12-s05-observation-key"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 7,
      "radius": 5.6,
      "intensity": 0.8,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 8,
      "radius": 4.3,
      "intensity": 0.5,
      "flicker": 0.22,
      "on": true
    },
    {
      "x": 9,
      "y": 3,
      "radius": 4.9,
      "intensity": 0.56,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 11,
      "radius": 4,
      "intensity": 0.5,
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
      "loop": true,
      "pauseSeconds": 1.49,
      "points": [
        {
          "x": 13,
          "y": 5
        },
        {
          "x": 3,
          "y": 7
        },
        {
          "x": 9,
          "y": 11
        },
        {
          "x": 18,
          "y": 4
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.27,
      "points": [
        {
          "x": 3,
          "y": 7
        },
        {
          "x": 9,
          "y": 11
        },
        {
          "x": 18,
          "y": 4
        },
        {
          "x": 1,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Observation. The airlock keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the airlock. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the airlock. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in moonLab. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Observation banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The airlock keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the airlock considers creaking.",
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
        "x": 10,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 10,
        "y": 6
      },
      {
        "x": 4,
        "y": 5
      },
      {
        "x": 4,
        "y": 11
      },
      {
        "x": 13,
        "y": 6
      }
    ],
    "aggression": 1.09,
    "scentBias": 0.72,
    "hearingBias": 0.49,
    "campHoleChance": 0.18,
    "leashRadius": 18
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 8,
      "optional": false,
      "label": "Bank 8 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 8,
  "parTime": 164,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 9.3,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "maze",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
