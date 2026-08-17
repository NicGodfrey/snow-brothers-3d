import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch11-s01-gear-floor",
  "chapter": 11,
  "index": 1,
  "name": "Gear Floor",
  "theme": "clocktower",
  "kind": "story",
  "seed": 220906866,
  "width": 24,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#......................#",
    "#...........##.........#",
    "#...........##.......s.#",
    "#......................#",
    "#...........s..........#",
    "#.........s......D.....#",
    "#...........##.........#",
    "#.......g...##.........#",
    "#...........##........o#",
    "########################"
  ],
  "decor": [
    "                  +     ",
    " +   .`,=*+   .`,=*+    ",
    " `,=*+   .`,  +   .`,=* ",
    "    .`,=*+   +`,=*+   . ",
    " ,=*+   .`,=*+   .`,=*+ ",
    "+  .`,=*+   .`,=*+   .` ",
    " =*+   .`,=*+   . ,=*+  ",
    "  .`,=*+   .+ =*+   .`, ",
    " *+   .`,=*+   .`,=*+   ",
    " .`,=*+   .`  *+   .`,= ",
    "                        "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 22,
      "y": 9,
      "id": "ch11-s01-gear-floor-hole"
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 6,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 18,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 14,
      "y": 8,
      "breed": "savannah",
      "patrol": 1,
      "facing": 5.29
    },
    {
      "type": "cat",
      "x": 4,
      "y": 6,
      "breed": "russianBlue",
      "patrol": 2,
      "facing": 5.26
    },
    {
      "type": "powerUp",
      "x": 21,
      "y": 3,
      "kind": "timeSlip"
    },
    {
      "type": "hazard",
      "x": 6,
      "y": 8,
      "kind": "snapTrap"
    },
    {
      "type": "hazard",
      "x": 17,
      "y": 5,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 1,
      "y": 8,
      "keyId": "ch11-s01-gear-floor-key"
    },
    {
      "type": "door",
      "x": 17,
      "y": 6,
      "id": "ch11-s01-gear-floor-door",
      "locked": true,
      "keyId": "ch11-s01-gear-floor-key"
    }
  ],
  "lights": [
    {
      "x": 18,
      "y": 5,
      "radius": 4,
      "intensity": 0.54,
      "flicker": 0.18,
      "on": true
    },
    {
      "x": 16,
      "y": 8,
      "radius": 3.8,
      "intensity": 0.88,
      "flicker": 0.34,
      "on": true
    },
    {
      "x": 21,
      "y": 1,
      "radius": 6,
      "intensity": 0.4,
      "flicker": 0,
      "on": true
    },
    {
      "x": 22,
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
      "pauseSeconds": 1.52,
      "points": [
        {
          "x": 14,
          "y": 8
        },
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 21,
          "y": 3
        },
        {
          "x": 6,
          "y": 8
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.82,
      "points": [
        {
          "x": 4,
          "y": 6
        },
        {
          "x": 21,
          "y": 3
        },
        {
          "x": 6,
          "y": 8
        },
        {
          "x": 17,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Gear Floor. The gears keeps a second set of books."
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
      "line": "Sneak the gears. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the gears. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in clocktower. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Gear Floor banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The gears keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the gears considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 22,
        "y": 8
      },
      {
        "x": 12,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 1
      },
      {
        "x": 6,
        "y": 6
      },
      {
        "x": 9,
        "y": 6
      },
      {
        "x": 14,
        "y": 6
      }
    ],
    "aggression": 0.97,
    "scentBias": 0.55,
    "hearingBias": 0.59,
    "campHoleChance": 0.17,
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
  "parTime": 159,
  "lives": 2,
  "ambient": 0.38,
  "difficulty": 8.1,
  "music": "clocktower-tick",
  "tags": [
    "clocktower",
    "dual",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
