import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-19-gear-flood",
  "chapter": 0,
  "index": 19,
  "name": "Gear Flood",
  "theme": "museum",
  "kind": "arcade",
  "seed": 8112800,
  "width": 24,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "########################",
    "#...................####",
    "#....#....#....#....####",
    "#....#....#....#....####",
    "#...................####",
    "#....#....#...Gr....####",
    "#..............#....####",
    "#.T..#....#....#....####",
    "#....#....#r...#....####",
    "#....#....#....#....####",
    "#....#....#....#....####",
    "#....#....#....#....####",
    "#..................o####",
    "########################"
  ],
  "decor": [
    "            +        +  ",
    "    .`,=*+   .`,=*+     ",
    " ,=*+   .`+=*+   .`,    ",
    "   .` =*+   .`, *+   +  ",
    " =*+   .`,=*+   .`,=    ",
    "  .`, *+   .`,=*+       ",
    " *+   .`,=*+    `,=*    ",
    " .=,= +    `,=*    .    ",
    " +    `,=*    . ,=*+    ",
    " `,=*    . ,=*+   .`+   ",
    "    . ,=*+   .` =*+     ",
    " ,=*+   .` =*+   .`, +  ",
    "   .`,=*+   .`,=*+      ",
    "   +        +           "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 12,
      "id": "arcade-19-gear-flood-hole"
    },
    {
      "type": "cheese",
      "x": 1,
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
      "x": 6,
      "y": 4,
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
      "x": 3,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 9,
      "y": 7,
      "breed": "persian",
      "patrol": 1,
      "facing": 1.63
    },
    {
      "type": "cat",
      "x": 12,
      "y": 9,
      "breed": "maineCoon",
      "patrol": 2,
      "facing": 4.17
    },
    {
      "type": "powerUp",
      "x": 19,
      "y": 1,
      "kind": "scentMask"
    },
    {
      "type": "hazard",
      "x": 4,
      "y": 11,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 13,
      "y": 9,
      "note": "vault"
    }
  ],
  "lights": [
    {
      "x": 19,
      "y": 8,
      "radius": 4.4,
      "intensity": 0.6,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
      "y": 11,
      "radius": 4.2,
      "intensity": 0.74,
      "flicker": 0.16,
      "on": true
    },
    {
      "x": 2,
      "y": 6,
      "radius": 5.3,
      "intensity": 0.51,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "loop": true,
      "pauseSeconds": 0.74,
      "points": [
        {
          "x": 9,
          "y": 7
        },
        {
          "x": 12,
          "y": 9
        },
        {
          "x": 19,
          "y": 1
        },
        {
          "x": 4,
          "y": 11
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.52,
      "points": [
        {
          "x": 12,
          "y": 9
        },
        {
          "x": 19,
          "y": 1
        },
        {
          "x": 4,
          "y": 11
        },
        {
          "x": 19,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Gear Flood. The vase keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the vase. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vase. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in museum. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. channels heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Gear Flood banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vase keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vase considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 11
      },
      {
        "x": 1,
        "y": 12
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 12
      },
      {
        "x": 18,
        "y": 9
      },
      {
        "x": 6,
        "y": 4
      },
      {
        "x": 11,
        "y": 6
      }
    ],
    "aggression": 0.6,
    "scentBias": 0.74,
    "hearingBias": 0.46,
    "campHoleChance": 0.31,
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
  "parTime": 143,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 5.3,
  "music": "museum-echo",
  "tags": [
    "museum",
    "channels",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
