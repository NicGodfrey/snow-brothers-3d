import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s03-bench-row",
  "chapter": 8,
  "index": 3,
  "name": "Bench Row",
  "theme": "subway",
  "kind": "story",
  "seed": 4281644794,
  "width": 19,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.................#",
    "#......r..........#",
    "#....##.######....#",
    "#....#########....#",
    "#....#########....#",
    "#...##########....#",
    "#...##########....#",
    "#...##########....#",
    "#...##########....#",
    "#.................#",
    "#...##########....#",
    "#...##########....#",
    "#...#####.####....#",
    "#D................#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "                   ",
    " *+   .`,=*+   .`, ",
    " .`,=*+   .`,=*+   ",
    " +     , ++   .`,= ",
    " `,=*         +    ",
    "    .  +     +`,=* ",
    " ,=*             . ",
    "   .          ,=*++",
    " =*++           .` ",
    "  .`+     +   =*+  ",
    " *+   .`,=*+   .`, ",
    " .`,       +  *+   ",
    " +  +         .`,= ",
    " `,=     .    +    ",
    "    .`,=*+   .`,=* ",
    " ,=*+   .`,=*+   . ",
    "                 + "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 15,
      "id": "ch08-s03-bench-row-hole"
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 14,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 10,
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
      "type": "cat",
      "x": 16,
      "y": 5,
      "breed": "abyssinian",
      "patrol": 1,
      "facing": 4.53
    },
    {
      "type": "cat",
      "x": 1,
      "y": 7,
      "breed": "bombay",
      "patrol": 2,
      "facing": 5.57
    },
    {
      "type": "powerUp",
      "x": 2,
      "y": 4,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 14,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 2,
      "y": 8,
      "keyId": "ch08-s03-bench-row-key"
    },
    {
      "type": "door",
      "x": 1,
      "y": 14,
      "id": "ch08-s03-bench-row-door",
      "locked": true,
      "keyId": "ch08-s03-bench-row-key"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 2,
      "radius": 3.9,
      "intensity": 0.66,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 17,
      "y": 5,
      "radius": 4.8,
      "intensity": 0.75,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 12,
      "radius": 5.4,
      "intensity": 0.45,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 1,
      "radius": 5.2,
      "intensity": 0.9,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 15,
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
      "pauseSeconds": 0.95,
      "points": [
        {
          "x": 16,
          "y": 5
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 15,
          "y": 14
        },
        {
          "x": 1,
          "y": 7
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.61,
      "points": [
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 15,
          "y": 14
        },
        {
          "x": 2,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Bench Row. The kiosk keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the kiosk. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the kiosk. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Bench Row banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The kiosk keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the kiosk considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 14
      },
      {
        "x": 3,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 3,
        "y": 7
      },
      {
        "x": 14,
        "y": 14
      },
      {
        "x": 14,
        "y": 2
      },
      {
        "x": 2,
        "y": 11
      }
    ],
    "aggression": 0.95,
    "scentBias": 0.48,
    "hearingBias": 0.59,
    "campHoleChance": 0.23,
    "leashRadius": 14
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 6,
      "optional": false,
      "label": "Bank 6 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 6,
  "parTime": 149,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6.3,
  "music": "subway-last",
  "tags": [
    "subway",
    "ring",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
