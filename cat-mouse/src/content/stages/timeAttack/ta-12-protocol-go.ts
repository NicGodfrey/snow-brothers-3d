import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-12-protocol-go",
  "chapter": 0,
  "index": 12,
  "name": "Protocol Go",
  "theme": "moonLab",
  "kind": "timeAttack",
  "seed": 3618960646,
  "width": 14,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "##############",
    "#............#",
    "#............#",
    "#...GG#.#....#",
    "#....##G#.##.#",
    "#.......#G...#",
    "#..G...#.....#",
    "#..........G.#",
    "#.######....o#",
    "#...........##",
    "##############"
  ],
  "decor": [
    "         +    ",
    " *+   .`,=*+  ",
    " .`,=*+   .`, ",
    " +   . , *+   ",
    " `,=*    .  = ",
    "    .`,= +    ",
    " ,=*+   .`,=* ",
    "   .`,=*+   . ",
    " =      `,=*+ ",
    "  .`,=*+   .  ",
    "    +         "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 12,
      "y": 8,
      "id": "ta-12-protocol-go-hole"
    },
    {
      "type": "cheese",
      "x": 4,
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
      "x": 1,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 3,
      "y": 6,
      "breed": "savannah",
      "patrol": 1,
      "facing": 4.6
    },
    {
      "type": "powerUp",
      "x": 9,
      "y": 5,
      "kind": "extraLife"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 9,
      "kind": "sparkWire"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 3,
      "radius": 4.1,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 10,
      "y": 6,
      "radius": 5.4,
      "intensity": 0.85,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 9,
      "radius": 5.5,
      "intensity": 0.45,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
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
      "pauseSeconds": 1.41,
      "points": [
        {
          "x": 3,
          "y": 6
        },
        {
          "x": 3,
          "y": 9
        },
        {
          "x": 2,
          "y": 3
        },
        {
          "x": 9,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Protocol Go. The cryo keeps a second set of books."
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
      "line": "Protocol Go banked. Whiskers attached."
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
        "x": 12,
        "y": 7
      },
      {
        "x": 4,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 4,
        "y": 9
      },
      {
        "x": 2,
        "y": 2
      },
      {
        "x": 1,
        "y": 5
      },
      {
        "x": 2,
        "y": 6
      }
    ],
    "aggression": 0.52,
    "scentBias": 0.48,
    "hearingBias": 0.56,
    "campHoleChance": 0.14,
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
      "value": 94,
      "optional": false,
      "label": "Beat 94s"
    }
  ],
  "quota": 4,
  "parTime": 94,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 2.4,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "maze",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
