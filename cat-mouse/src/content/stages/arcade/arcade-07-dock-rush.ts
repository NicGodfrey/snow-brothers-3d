import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-07-dock-rush",
  "chapter": 0,
  "index": 7,
  "name": "Dock Rush",
  "theme": "museum",
  "kind": "arcade",
  "seed": 2894096695,
  "width": 18,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "##################",
    "##################",
    "##..............##",
    "##..............##",
    "##..............##",
    "##...#############",
    "##...#############",
    "##..............##",
    "##..............##",
    "##....##........##",
    "##.#..#######.####",
    "##.#..#######.####",
    "##.......##....r##",
    "##.............o##",
    "##################",
    "##################"
  ],
  "decor": [
    "                  ",
    "                  ",
    "  `,=*+   .`,=*+  ",
    "     .`,=*+   .`  ",
    "  ,=*+   .`,=*+   ",
    "    .    +        ",
    "+ =*+          +  ",
    "   .`,=*+   .`,=  ",
    "  *+   .`,=*+     ",
    " +.`,=     .`,=*  ",
    "  +      +        ",
    "  ` =*       =    ",
    "     .`,=     .`  ",
    "  ,=*+   .`,=*+   ",
    "                  ",
    "            +  +  "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 15,
      "y": 13,
      "id": "arcade-07-dock-rush-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 13,
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
      "x": 11,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 8,
      "breed": "persian",
      "patrol": 1,
      "facing": 1.22
    },
    {
      "type": "powerUp",
      "x": 9,
      "y": 4,
      "kind": "timeSlip"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 7,
      "radius": 5.1,
      "intensity": 0.72,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 7,
      "radius": 5.6,
      "intensity": 0.45,
      "flicker": 0.27,
      "on": true
    },
    {
      "x": 4,
      "y": 8,
      "radius": 5.7,
      "intensity": 0.4,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 3,
      "radius": 3.3,
      "intensity": 0.54,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
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
      "pauseSeconds": 1.21,
      "points": [
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 9,
          "y": 4
        },
        {
          "x": 10,
          "y": 7
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
      "line": "Dock Rush. The armor keeps a second set of books."
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
      "line": "Sneak the armor. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the armor. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in museum. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. rooms heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Dock Rush banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The armor keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the armor considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 15,
        "y": 12
      },
      {
        "x": 9,
        "y": 8
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 8
      },
      {
        "x": 3,
        "y": 7
      },
      {
        "x": 3,
        "y": 12
      },
      {
        "x": 5,
        "y": 13
      }
    ],
    "aggression": 0.64,
    "scentBias": 0.66,
    "hearingBias": 0.71,
    "campHoleChance": 0.18,
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
  "parTime": 131,
  "lives": 3,
  "ambient": 0.55,
  "difficulty": 3.8,
  "music": "museum-echo",
  "tags": [
    "museum",
    "rooms",
    "arcade",
    "solo-cat",
    "q5"
  ]
};

export default stage;
