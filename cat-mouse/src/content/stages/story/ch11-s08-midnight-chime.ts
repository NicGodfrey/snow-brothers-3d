import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s08-midnight-chime",
  "chapter": 11,
  "index": 8,
  "name": "Midnight Chime",
  "theme": "clocktower",
  "kind": "story",
  "seed": 2877359873,
  "width": 15,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.#.##.###.####",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#............o#",
    "###############",
    "###############",
    "###############"
  ],
  "decor": [
    "        +      ",
    " =*+   .`,=*+ +",
    "  .`,=*+   .`,+",
    " *+   .`,=*+  +",
    " .`,=*+   .`,= ",
    " +   .`,=*+    ",
    " `,=*+   .`,=* ",
    "      ,        ",
    " ,=*+   .`,=*++",
    "   .`,=*+   .` ",
    " =*+   .`,=*+  ",
    "  .`,=*+   .`, ",
    " *+   .`,=*+   ",
    " .`,=*+   .`,= ",
    "              +",
    "               ",
    "        +      "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 13,
      "id": "ch11-s08-midnight-chime-hole"
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 11,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 12,
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
      "type": "cheese",
      "x": 3,
      "y": 8,
      "value": 1,
      "guarded": false
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
      "x": 1,
      "y": 8,
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
      "x": 6,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 1,
      "y": 9,
      "breed": "manx",
      "patrol": 1,
      "facing": 1.31
    },
    {
      "type": "cat",
      "x": 11,
      "y": 9,
      "breed": "savannah",
      "patrol": 2,
      "facing": 3.5
    },
    {
      "type": "powerUp",
      "x": 7,
      "y": 9,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 1,
      "y": 7,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 8,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 12,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 12,
      "y": 10,
      "note": "gears"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 13,
      "radius": 3.7,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 4,
      "radius": 4.3,
      "intensity": 0.56,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 10,
      "radius": 5.5,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "loop": false,
      "pauseSeconds": 0.71,
      "points": [
        {
          "x": 1,
          "y": 9
        },
        {
          "x": 11,
          "y": 9
        },
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 7,
          "y": 9
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.14,
      "points": [
        {
          "x": 11,
          "y": 9
        },
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 7,
          "y": 9
        },
        {
          "x": 2,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Midnight Chime. The pendulum keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 9. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the pendulum. Dash is postage. The channels layout lies about shortcuts.",
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
      "line": "Half of 9. channels heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Midnight Chime banked. Whiskers attached."
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
        "x": 13,
        "y": 12
      },
      {
        "x": 4,
        "y": 11
      }
    ],
    "searchSpots": [
      {
        "x": 4,
        "y": 11
      },
      {
        "x": 7,
        "y": 12
      },
      {
        "x": 6,
        "y": 1
      },
      {
        "x": 3,
        "y": 8
      }
    ],
    "aggression": 0.97,
    "scentBias": 0.81,
    "hearingBias": 0.63,
    "campHoleChance": 0.25,
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
  "parTime": 167,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 9,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "channels",
    "story",
    "multi-cat",
    "q9"
  ]
};

export default stage;
