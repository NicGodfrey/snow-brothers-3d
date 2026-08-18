import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch04-s05-maintenance-walk",
  "chapter": 4,
  "index": 5,
  "name": "Maintenance Walk",
  "theme": "sewer",
  "kind": "story",
  "seed": 221062246,
  "width": 19,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "###################",
    "#.........D.......#",
    "#.................#",
    "#............g....#",
    "#.....###.####....#",
    "#...#.~~~.~~~~....#",
    "#...#.~~~.~~~~....#",
    "#...#.~~~.~~~~....#",
    "#...#.###.#.##....#",
    "#.....g...........#",
    "#.................#",
    "#................o#",
    "###################"
  ],
  "decor": [
    "          +        ",
    " `,=*+   . ,=*+    ",
    "    .`,=*+   .`,=* ",
    " ,=*+   .`,=*+   . ",
    "   .`,     +  ,=*+ ",
    " =*+   .`,=*+   .` ",
    "+ .` =*+   .`,=*+  ",
    " *+ + .`,=*+   .`, ",
    " .`, *     `  *+   ",
    " +   .`,=*+   .`,= ",
    " `,=*+   .`,=*+    ",
    "    .`,=*+   .`,=* ",
    "     +        +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 17,
      "y": 11,
      "id": "ch04-s05-maintenance-walk-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 10,
      "y": 6,
      "breed": "norwegianForest",
      "patrol": 1,
      "facing": 0.07
    },
    {
      "type": "powerUp",
      "x": 1,
      "y": 4,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 12,
      "y": 10,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 2,
      "y": 3,
      "keyId": "ch04-s05-maintenance-walk-key"
    },
    {
      "type": "door",
      "x": 10,
      "y": 1,
      "id": "ch04-s05-maintenance-walk-door",
      "locked": true,
      "keyId": "ch04-s05-maintenance-walk-key"
    }
  ],
  "lights": [
    {
      "x": 12,
      "y": 7,
      "radius": 4.2,
      "intensity": 0.86,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 7,
      "radius": 5.7,
      "intensity": 0.42,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 10,
      "radius": 5.3,
      "intensity": 0.8,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
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
      "pauseSeconds": 1.05,
      "points": [
        {
          "x": 10,
          "y": 6
        },
        {
          "x": 1,
          "y": 4
        },
        {
          "x": 12,
          "y": 10
        },
        {
          "x": 2,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Maintenance Walk. The outflow keeps a second set of books."
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
      "line": "Sneak the outflow. Dash is postage. The ring layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the outflow. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in sewer. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Maintenance Walk banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The outflow keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the outflow considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 17,
        "y": 10
      },
      {
        "x": 9,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 5
      },
      {
        "x": 9,
        "y": 9
      },
      {
        "x": 17,
        "y": 1
      },
      {
        "x": 4,
        "y": 3
      }
    ],
    "aggression": 0.72,
    "scentBias": 0.67,
    "hearingBias": 0.36,
    "campHoleChance": 0.2,
    "leashRadius": 10
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 4,
  "parTime": 119,
  "lives": 3,
  "ambient": 0.3,
  "difficulty": 3.7,
  "music": "sewer-flow",
  "tags": [
    "sewer",
    "ring",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
