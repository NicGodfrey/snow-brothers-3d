import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ta-07-foyer-blitz",
  "chapter": 0,
  "index": 7,
  "name": "Foyer Blitz",
  "theme": "museum",
  "kind": "timeAttack",
  "seed": 4072951169,
  "width": 16,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "################",
    "################",
    "##..........r.##",
    "##....s.......##",
    "##.#.###..#.####",
    "##.#.###..#.####",
    "##....##......##",
    "##..rr##......##",
    "##............##",
    "##...........o##",
    "################",
    "################"
  ],
  "decor": [
    "      +         ",
    "   ++           ",
    "     .`,=*+     ",
    "  ,=*+   .`,=*  ",
    "+   .   *+      ",
    "+ = +   .` =    ",
    "   .`,  +   .`  ",
    "  *+    `,=*+   ",
    "  .`,=*+   .`,  ",
    "  +   .`,=*+    ",
    "+      +        ",
    "         +     +"
  ],
  "spawn": {
    "x": 2,
    "y": 2
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 9,
      "id": "ta-07-foyer-blitz-hole"
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 8,
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
      "x": 11,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 8,
      "y": 9,
      "breed": "persian",
      "patrol": 1,
      "facing": 3.11
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 2,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 2,
      "y": 3,
      "note": "armor"
    }
  ],
  "lights": [
    {
      "x": 5,
      "y": 2,
      "radius": 3.3,
      "intensity": 0.83,
      "flicker": 0.12,
      "on": true
    },
    {
      "x": 10,
      "y": 2,
      "radius": 5.6,
      "intensity": 0.89,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 6,
      "radius": 5.8,
      "intensity": 0.53,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "pauseSeconds": 0.98,
      "points": [
        {
          "x": 8,
          "y": 9
        },
        {
          "x": 2,
          "y": 3
        },
        {
          "x": 11,
          "y": 2
        },
        {
          "x": 5,
          "y": 2
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Foyer Blitz. The vase keeps a second set of books."
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
      "line": "Sneak the vase. Dash is postage. The rooms layout lies about shortcuts.",
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
      "line": "Half of 4. rooms heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Foyer Blitz banked. Whiskers attached."
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
        "x": 13,
        "y": 8
      },
      {
        "x": 9,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 9,
        "y": 7
      },
      {
        "x": 8,
        "y": 6
      },
      {
        "x": 11,
        "y": 8
      },
      {
        "x": 8,
        "y": 2
      }
    ],
    "aggression": 0.4,
    "scentBias": 0.41,
    "hearingBias": 0.56,
    "campHoleChance": 0.09,
    "leashRadius": 6
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "timeLimit",
      "value": 98,
      "optional": false,
      "label": "Beat 98s"
    }
  ],
  "quota": 4,
  "parTime": 98,
  "lives": 2,
  "ambient": 0.55,
  "difficulty": 1.8,
  "music": "museum-echo",
  "tags": [
    "museum",
    "rooms",
    "timeAttack",
    "solo-cat",
    "q4"
  ]
};

export default stage;
