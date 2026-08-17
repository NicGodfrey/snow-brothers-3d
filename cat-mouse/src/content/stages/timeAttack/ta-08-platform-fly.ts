import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-08-platform-fly",
  "chapter": 0,
  "index": 8,
  "name": "Platform Fly",
  "theme": "subway",
  "kind": "timeAttack",
  "seed": 681845991,
  "width": 18,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "##################",
    "#...............##",
    "#...#..g#...#...##",
    "#...#...#...#...##",
    "#...#...#...#...##",
    "#...#.........g.##",
    "#...#...#...#...##",
    "#.......#...#...##",
    "#...#...#...#...##",
    "#...#...#...#...##",
    "#..............o##",
    "##################"
  ],
  "decor": [
    "       +     +    ",
    " ,=*+   .`,=*+    ",
    "   . ,=*     `,=  ",
    " =*+   . ,=*      ",
    "  .` =*+   .+,=*  ",
    " *+   .`,=*+   .  ",
    " .`, *+   .` =*+  ",
    "++   .`, *+   .`  ",
    " `,=++   .`, *+   ",
    "     `,= +   .`,  ",
    " ,=*+   .`,=*+  + ",
    "+      +          "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 10,
      "id": "ta-08-platform-fly-hole"
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 4,
      "y": 10,
      "breed": "bombay",
      "patrol": 1,
      "facing": 3.03
    },
    {
      "type": "hazard",
      "x": 10,
      "y": 8,
      "kind": "sparkWire"
    },
    {
      "type": "decorProp",
      "x": 7,
      "y": 3,
      "note": "platform"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 10,
      "radius": 6.1,
      "intensity": 0.69,
      "flicker": 0.17,
      "on": true
    },
    {
      "x": 9,
      "y": 9,
      "radius": 3.7,
      "intensity": 0.8,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 10,
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
      "pauseSeconds": 1.7,
      "points": [
        {
          "x": 4,
          "y": 10
        },
        {
          "x": 10,
          "y": 8
        },
        {
          "x": 7,
          "y": 3
        },
        {
          "x": 11,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Platform Fly. The turnstile keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the turnstile. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the turnstile. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Platform Fly banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The turnstile keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the turnstile considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 9
      },
      {
        "x": 5,
        "y": 9
      }
    ],
    "searchSpots": [
      {
        "x": 5,
        "y": 9
      },
      {
        "x": 9,
        "y": 1
      },
      {
        "x": 15,
        "y": 1
      },
      {
        "x": 2,
        "y": 3
      }
    ],
    "aggression": 0.43,
    "scentBias": 0.58,
    "hearingBias": 0.76,
    "campHoleChance": 0.17,
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
      "value": 101,
      "optional": false,
      "label": "Beat 101s"
    }
  ],
  "quota": 4,
  "parTime": 101,
  "lives": 2,
  "ambient": 0.36,
  "difficulty": 2,
  "music": "subway-last",
  "tags": [
    "subway",
    "channels",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
