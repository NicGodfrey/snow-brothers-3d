import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s07-stray-circle",
  "chapter": 3,
  "index": 7,
  "name": "Stray Circle",
  "theme": "alley",
  "kind": "story",
  "seed": 290363127,
  "width": 21,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#####################",
    "##.................r#",
    "##.................##",
    "##.................##",
    "##.................##",
    "##....g............##",
    "##.................##",
    "##................g##",
    "##.................##",
    "##.................##",
    "##................o##",
    "#####################",
    "#####################"
  ],
  "decor": [
    "+             +      ",
    " +   +               ",
    "   .`,=*+   .`,=*+   ",
    "  *+   .`,=*+   .`, +",
    "  .`,=*+   .`,=*+    ",
    "  +   .`,=*+   .`,=  ",
    "  `,=*+   .`,=*+     ",
    "     .`,=*+   .`,=*  ",
    "  ,=*+   .`,=*+   .  ",
    "    .`,=*+   .`,=*+ +",
    "  =*+   .`,=*+   .`  ",
    "   .`,=*+   .`,=*+   ",
    "           + +     + ",
    "                     "
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 11,
      "id": "ch03-s07-stray-circle-hole"
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 7,
      "value": 1,
      "guarded": true
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
      "x": 8,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 5,
      "y": 4,
      "breed": "bengal",
      "patrol": 1,
      "facing": 2.83
    },
    {
      "type": "powerUp",
      "x": 17,
      "y": 7,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 7,
      "y": 5,
      "kind": "fan"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 6,
      "radius": 4.3,
      "intensity": 0.75,
      "flicker": 0.23,
      "on": true
    },
    {
      "x": 16,
      "y": 11,
      "radius": 4.2,
      "intensity": 0.77,
      "flicker": 0,
      "on": true
    },
    {
      "x": 18,
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
      "pauseSeconds": 0.94,
      "points": [
        {
          "x": 5,
          "y": 4
        },
        {
          "x": 17,
          "y": 7
        },
        {
          "x": 7,
          "y": 5
        },
        {
          "x": 11,
          "y": 6
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Stray Circle. The dumpster keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the dumpster. Dash is postage. The rooms layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the dumpster. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. rooms heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Stray Circle banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The dumpster keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the dumpster considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 18,
        "y": 10
      },
      {
        "x": 12,
        "y": 4
      }
    ],
    "searchSpots": [
      {
        "x": 12,
        "y": 4
      },
      {
        "x": 2,
        "y": 7
      },
      {
        "x": 3,
        "y": 8
      },
      {
        "x": 8,
        "y": 7
      }
    ],
    "aggression": 0.67,
    "scentBias": 0.77,
    "hearingBias": 0.64,
    "campHoleChance": 0.07,
    "leashRadius": 9
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
  "ambient": 0.34,
  "difficulty": 3.2,
  "music": "alley-neon",
  "tags": [
    "alley",
    "rooms",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
