import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s06-counterweight",
  "chapter": 11,
  "index": 6,
  "name": "Counterweight",
  "theme": "clocktower",
  "kind": "story",
  "seed": 2924301786,
  "width": 18,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "##################",
    "#................#",
    "#...........pp...#",
    "#.......gg..ppg..#",
    "#..pp.gggg..ppg..#",
    "#..pp.ggggggppg..#",
    "#..pp.ggggggg....#",
    "#..pp.ggggg......#",
    "#.LL.............#",
    "#................#",
    "#.LL.............#",
    "#.LL.............#",
    "#................#",
    "#...............o#",
    "##################"
  ],
  "decor": [
    "         +        ",
    "+,=*+   .`,=*+    ",
    "   .`,=*+   .`,=* ",
    " =*+   .`,=*+   . ",
    "  .`,=*+   .`,=*+ ",
    "+*+   .`,=*+   .` ",
    " .`,=*+   .`,=*+  ",
    " +   .`,=*+   .`, ",
    " `,=*+   .`,=*+   ",
    "    .`,=*+   .`,= ",
    " ,=*+   .`,=*+    ",
    "   .`,=*+   .`,=* ",
    " =*+   .`,=*+   . ",
    "  .`,=*+   .`,=*+ ",
    "+            +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 16,
      "y": 13,
      "id": "ch11-s06-counterweight-hole"
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 3,
      "y": 3,
      "breed": "russianBlue",
      "patrol": 1,
      "facing": 1.4
    },
    {
      "type": "cat",
      "x": 9,
      "y": 3,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 5.88
    },
    {
      "type": "powerUp",
      "x": 16,
      "y": 10,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 12,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 8,
      "y": 5,
      "note": "gears"
    }
  ],
  "lights": [
    {
      "x": 14,
      "y": 9,
      "radius": 4.1,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
      "y": 4,
      "radius": 4.5,
      "intensity": 0.61,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
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
      "pauseSeconds": 1.64,
      "points": [
        {
          "x": 3,
          "y": 3
        },
        {
          "x": 9,
          "y": 3
        },
        {
          "x": 16,
          "y": 10
        },
        {
          "x": 3,
          "y": 12
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.37,
      "points": [
        {
          "x": 9,
          "y": 3
        },
        {
          "x": 16,
          "y": 10
        },
        {
          "x": 3,
          "y": 12
        },
        {
          "x": 8,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Counterweight. The escapement keeps a second set of books."
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
      "line": "Sneak the escapement. Dash is postage. The islands layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the escapement. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 9. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Counterweight banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The escapement keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the escapement considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 16,
        "y": 12
      },
      {
        "x": 5,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 5,
        "y": 11
      },
      {
        "x": 12,
        "y": 9
      },
      {
        "x": 4,
        "y": 12
      },
      {
        "x": 4,
        "y": 3
      }
    ],
    "aggression": 1.09,
    "scentBias": 0.4,
    "hearingBias": 0.72,
    "campHoleChance": 0.28,
    "leashRadius": 17
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
  "parTime": 168,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.7,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "islands",
    "story",
    "multi-cat",
    "q9"
  ]
};

export default stage;
