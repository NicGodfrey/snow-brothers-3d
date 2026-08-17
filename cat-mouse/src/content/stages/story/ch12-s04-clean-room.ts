import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s04-clean-room",
  "chapter": 12,
  "index": 4,
  "name": "Clean Room",
  "theme": "moonLab",
  "kind": "story",
  "seed": 3050529511,
  "width": 16,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "################",
    "################",
    "##............##",
    "##....#.......##",
    "##....#.......##",
    "##............##",
    "##....#.......##",
    "##....#.......##",
    "##.##.##.####.##",
    "##.##.##.####.##",
    "##.D..........##",
    "##............##",
    "##.....G....G.##",
    "##...........o##",
    "################",
    "################"
  ],
  "decor": [
    "   +            ",
    "                ",
    "  `,=*+   .`,=  ",
    "     . ,=*+     ",
    "+ ,=*+   .`,=*  ",
    " +  .`,=*+   .  ",
    "  =*+   .`,=*+  ",
    "+  .`, *+   .`  ",
    "  *     `       ",
    "+ .+ =   +   ,  ",
    "+ +   .`,=*+  + ",
    "  `,=*+   .`,=  ",
    "     .`,=*+     ",
    "  ,=*+   .`,=*  ",
    "     +          ",
    "                "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 13,
      "id": "ch12-s04-clean-room-hole"
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 4,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 13,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 3,
      "breed": "savannah",
      "patrol": 1,
      "facing": 6.2
    },
    {
      "type": "cat",
      "x": 10,
      "y": 11,
      "breed": "bengal",
      "patrol": 2,
      "facing": 5.82
    },
    {
      "type": "powerUp",
      "x": 12,
      "y": 12,
      "kind": "extraLife"
    },
    {
      "type": "hazard",
      "x": 7,
      "y": 6,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 13,
      "y": 9,
      "kind": "fan"
    },
    {
      "type": "key",
      "x": 2,
      "y": 10,
      "keyId": "ch12-s04-clean-room-key"
    },
    {
      "type": "door",
      "x": 3,
      "y": 10,
      "id": "ch12-s04-clean-room-door",
      "locked": true,
      "keyId": "ch12-s04-clean-room-key"
    }
  ],
  "lights": [
    {
      "x": 12,
      "y": 13,
      "radius": 5.7,
      "intensity": 0.58,
      "flicker": 0,
      "on": true
    },
    {
      "x": 8,
      "y": 2,
      "radius": 4.4,
      "intensity": 0.82,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 5,
      "radius": 5.1,
      "intensity": 0.75,
      "flicker": 0.2,
      "on": true
    },
    {
      "x": 11,
      "y": 3,
      "radius": 5.1,
      "intensity": 0.6,
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
      "loop": true,
      "pauseSeconds": 0.62,
      "points": [
        {
          "x": 8,
          "y": 3
        },
        {
          "x": 12,
          "y": 13
        },
        {
          "x": 10,
          "y": 11
        },
        {
          "x": 7,
          "y": 6
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 0.66,
      "points": [
        {
          "x": 10,
          "y": 11
        },
        {
          "x": 12,
          "y": 13
        },
        {
          "x": 7,
          "y": 6
        },
        {
          "x": 13,
          "y": 9
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Clean Room. The vault keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 8. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the vault. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the vault. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in moonLab. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 8. rooms heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Clean Room banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The vault keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the vault considers creaking.",
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
        "x": 4,
        "y": 13
      },
      {
        "x": 10,
        "y": 13
      },
      {
        "x": 12,
        "y": 3
      }
    ],
    "aggression": 1,
    "scentBias": 0.41,
    "hearingBias": 0.69,
    "campHoleChance": 0.28,
    "leashRadius": 18
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
  "ambient": 0.7,
  "difficulty": 9.2,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "rooms",
    "story",
    "multi-cat",
    "q8"
  ]
};

export default stage;
