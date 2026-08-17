import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s06-sludge-bend",
  "chapter": 4,
  "index": 6,
  "name": "Sludge Bend",
  "theme": "sewer",
  "kind": "story",
  "seed": 3899884713,
  "width": 19,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#.....#...........#",
    "#.....#...........#",
    "#.................#",
    "#.....#...........#",
    "#.................#",
    "#...g.........g...#",
    "#.....##..D....g..#",
    "#.................#",
    "#.................#",
    "#.....##..........#",
    "#.....##..........#",
    "#.....##..........#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "+  +    +          ",
    " ,=*+   .`,=*+   . ",
    "   .`, *+   .`,=*+ ",
    " =*+   .`,=*+   .` ",
    "  .`,=*+   .`,=*+  ",
    " *+    `,=*+   .`, ",
    " .`,=*+   .`,=*+   ",
    " +   .`,=*+   .`,= ",
    " `,=*+   . ,=*+    ",
    "    .`,=*+   .`,=* ",
    " ,=*+   .`,=*+   . ",
    "   .`,  +   .`,=*+ ",
    " =*+    `,=*+   .` ",
    "  .`,=     .`,=*+ +",
    "+*+   .`,=*+   .`, ",
    "     +    +        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 14,
      "id": "ch04-s06-sludge-bend-hole"
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 12,
      "y": 4,
      "breed": "bombay",
      "patrol": 1,
      "facing": 4.94
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 8,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 11,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 13,
      "y": 2,
      "keyId": "ch04-s06-sludge-bend-key"
    },
    {
      "type": "door",
      "x": 10,
      "y": 8,
      "id": "ch04-s06-sludge-bend-door",
      "locked": true,
      "keyId": "ch04-s06-sludge-bend-key"
    },
    {
      "type": "decorProp",
      "x": 10,
      "y": 10,
      "note": "grate well"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 5,
      "radius": 3.9,
      "intensity": 0.63,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 7,
      "radius": 5,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "loop": true,
      "pauseSeconds": 1.54,
      "points": [
        {
          "x": 12,
          "y": 4
        },
        {
          "x": 13,
          "y": 8
        },
        {
          "x": 11,
          "y": 11
        },
        {
          "x": 13,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Sludge Bend. The grate well keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the grate well. Dash is postage. The dual layout lies about shortcuts.",
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
      "line": "Half of 5. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Sludge Bend banked. Whiskers attached."
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
        "y": 13
      },
      {
        "x": 8,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 8,
        "y": 4
      },
      {
        "x": 9,
        "y": 10
      },
      {
        "x": 12,
        "y": 7
      },
      {
        "x": 17,
        "y": 10
      }
    ],
    "aggression": 0.63,
    "scentBias": 0.64,
    "hearingBias": 0.55,
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
  "parTime": 132,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 3.8,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "dual",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
