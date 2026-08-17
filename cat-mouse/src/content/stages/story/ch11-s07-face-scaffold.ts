import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s07-face-scaffold",
  "chapter": 11,
  "index": 7,
  "name": "Face Scaffold",
  "theme": "clocktower",
  "kind": "story",
  "seed": 2152060016,
  "width": 24,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#.......##.............#",
    "#......................#",
    "#.......##.............#",
    "#......................#",
    "#.......##.............#",
    "#.......##.............#",
    "#......................#",
    "#......................#",
    "#......................#",
    "#......................#",
    "#.....................o#",
    "########################"
  ],
  "decor": [
    "     +             +    ",
    " =*+   .`,=*+   .`,=*+  ",
    "  .`,=*+   .`,=*+   .`, ",
    " *+   .`,=*+   .`,=*+   ",
    " .`,=*+   .`,=*+   .`,= ",
    " +   .`,=*+   .`,=*+   +",
    " `,=*+   +`,=*+   .`,=* ",
    "    .`,= +   .`,=*+   . ",
    " ,=*+   .`,=*+   .`,=*+ ",
    "   .`,=*+   .`,=*+   .` ",
    " =*+   .`,=*+   .`,=*+ +",
    "  .`,=*+   .`,=*+   .`, ",
    " *+   .`,=*+   .`,=*+   ",
    "      +                 "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 12,
      "id": "ch11-s07-face-scaffold-hole"
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
      "x": 16,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 20,
      "y": 5,
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
      "x": 12,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 8,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 18,
      "y": 8,
      "breed": "maineCoon",
      "patrol": 1,
      "facing": 2.2
    },
    {
      "type": "cat",
      "x": 9,
      "y": 10,
      "breed": "manx",
      "patrol": 2,
      "facing": 0.27
    },
    {
      "type": "powerUp",
      "x": 3,
      "y": 10,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 21,
      "y": 5,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 12,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 7,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 22,
      "y": 11,
      "note": "escapement"
    }
  ],
  "lights": [
    {
      "x": 1,
      "y": 2,
      "radius": 4.1,
      "intensity": 0.66,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 5,
      "radius": 3.7,
      "intensity": 0.8,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 3,
      "radius": 3.3,
      "intensity": 0.42,
      "flicker": 0.24,
      "on": true
    },
    {
      "x": 21,
      "y": 8,
      "radius": 4.3,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 22,
      "y": 12,
      "radius": 2.2,
      "intensity": 0.75,
      "color": "#d4f0a0",
      "on": true
    }
  ],
  "patrols": [
    {
      "id": 1,
      "loop": false,
      "pauseSeconds": 0.61,
      "points": [
        {
          "x": 18,
          "y": 8
        },
        {
          "x": 22,
          "y": 11
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 9,
          "y": 10
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.98,
      "points": [
        {
          "x": 9,
          "y": 10
        },
        {
          "x": 22,
          "y": 11
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 3,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Face Scaffold. The pendulum keeps a second set of books."
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
      "line": "Sneak the pendulum. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the pendulum. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 9. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Face Scaffold banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The pendulum keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the pendulum considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 11
      },
      {
        "x": 1,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 5
      },
      {
        "x": 16,
        "y": 12
      },
      {
        "x": 18,
        "y": 9
      },
      {
        "x": 20,
        "y": 1
      }
    ],
    "aggression": 0.99,
    "scentBias": 0.44,
    "hearingBias": 0.83,
    "campHoleChance": 0.22,
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
  "parTime": 175,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.8,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "dual",
    "story",
    "multi-cat",
    "q9"
  ]
};

export default stage;
