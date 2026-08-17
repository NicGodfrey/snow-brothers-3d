import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s04-escapement",
  "chapter": 11,
  "index": 4,
  "name": "Escapement",
  "theme": "clocktower",
  "kind": "story",
  "seed": 1565966843,
  "width": 23,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#######################",
    "#.....................#",
    "#..............L......#",
    "#.....................#",
    "#..#######..#####.#...#",
    "#.....................#",
    "#...L....p....g....L..#",
    "#.....................#",
    "#.....................#",
    "#....................o#",
    "#######################"
  ],
  "decor": [
    "    +                  ",
    " .`,=*+   .`,=*+   .`, ",
    " +   .`,=*+   .`,=*+   ",
    " `,=*+   .`,=*+   .`,=+",
    "     +  +        *    +",
    " ,=*+   .`,=*+   .`,=* ",
    "   .`,=*+   .`,=*+   .+",
    " =*+   .`,=*+   .`,=*+ ",
    "  .`,=*+   .`,=*+   .` ",
    " *+   .`,=*+   .`,=*+  ",
    "             +     +   "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 21,
      "y": 9,
      "id": "ch11-s04-escapement-hole"
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 5,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 2,
      "value": 1,
      "guarded": false
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
      "x": 7,
      "y": 2,
      "value": 1,
      "guarded": true
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
      "x": 11,
      "y": 6,
      "value": 1,
      "guarded": false
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
      "x": 18,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 19,
      "y": 6,
      "breed": "manx",
      "patrol": 1,
      "facing": 4.18
    },
    {
      "type": "cat",
      "x": 1,
      "y": 7,
      "breed": "savannah",
      "patrol": 2,
      "facing": 1.74
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 2,
      "kind": "featherFoot"
    },
    {
      "type": "hazard",
      "x": 2,
      "y": 5,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 2,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 21,
      "y": 3,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 3,
      "note": "bell"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 7,
      "radius": 3.6,
      "intensity": 0.76,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 8,
      "radius": 3.3,
      "intensity": 0.78,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
      "y": 9,
      "radius": 6.1,
      "intensity": 0.45,
      "flicker": 0.17,
      "on": true
    },
    {
      "x": 3,
      "y": 9,
      "radius": 4.6,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 21,
      "y": 9,
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
      "pauseSeconds": 1.5,
      "points": [
        {
          "x": 19,
          "y": 6
        },
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 2,
          "y": 5
        },
        {
          "x": 13,
          "y": 2
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.57,
      "points": [
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 2,
          "y": 5
        },
        {
          "x": 13,
          "y": 2
        },
        {
          "x": 4,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Escapement. The bell keeps a second set of books."
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
      "line": "Sneak the bell. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the bell. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. galleries heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Escapement banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The bell keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the bell considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 21,
        "y": 8
      },
      {
        "x": 7,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 7,
        "y": 5
      },
      {
        "x": 19,
        "y": 5
      },
      {
        "x": 9,
        "y": 2
      },
      {
        "x": 17,
        "y": 7
      }
    ],
    "aggression": 1.02,
    "scentBias": 0.84,
    "hearingBias": 0.38,
    "campHoleChance": 0.26,
    "leashRadius": 17
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
  "parTime": 158,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.5,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "galleries",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
