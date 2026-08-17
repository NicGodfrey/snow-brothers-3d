import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-06-grate-storm",
  "chapter": 0,
  "index": 6,
  "name": "Grate Storm",
  "theme": "carnival",
  "kind": "arcade",
  "seed": 3787463070,
  "width": 21,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#..X...G...G...T....#",
    "#...................#",
    "#...................#",
    "#...................#",
    "#..###.#.##########.#",
    "#...................#",
    "#...T....X....T.....#",
    "#...................#",
    "#...................#",
    "#...................#",
    "#..................o#",
    "#####################"
  ],
  "decor": [
    "     +               ",
    "  .`,=*+   .`,=*+    ",
    " *+=  .`,=*+    `,=* ",
    " .`,=*+   .`,=*+   . ",
    " +   .`,=*+   .`,=*+ ",
    " `,=*+   .`,=*+   .` ",
    "      , *  +         ",
    " ,=*+   .`,=*+   .`, ",
    "   . ,=*+=  .`==*+   ",
    " =*+   .`,=*+   .`,= ",
    "  .`,=*+   .`,=*+   +",
    " *+   .`,=*+   .`,=* ",
    " .`,=*+   .`,=*+   . ",
    "      +              "
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
      "id": "arcade-06-grate-storm-hole"
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 3,
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
      "x": 8,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 8,
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
      "x": 4,
      "y": 5,
      "breed": "calico",
      "patrol": 1,
      "facing": 1.56
    },
    {
      "type": "powerUp",
      "x": 18,
      "y": 11,
      "kind": "decoy"
    },
    {
      "type": "decorProp",
      "x": 6,
      "y": 8,
      "note": "prize tent"
    }
  ],
  "lights": [
    {
      "x": 7,
      "y": 12,
      "radius": 5.9,
      "intensity": 0.66,
      "flicker": 0.12,
      "on": true
    },
    {
      "x": 3,
      "y": 10,
      "radius": 4.9,
      "intensity": 0.84,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 11,
      "radius": 4,
      "intensity": 0.67,
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
      "pauseSeconds": 0.47,
      "points": [
        {
          "x": 4,
          "y": 5
        },
        {
          "x": 18,
          "y": 11
        },
        {
          "x": 6,
          "y": 8
        },
        {
          "x": 7,
          "y": 12
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Grate Storm. The booth keeps a second set of books."
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
      "line": "Sneak the booth. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the booth. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. galleries heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Grate Storm banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The booth keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the booth considers creaking.",
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
        "x": 17,
        "y": 10
      }
    ],
    "searchSpots": [
      {
        "x": 17,
        "y": 10
      },
      {
        "x": 5,
        "y": 3
      },
      {
        "x": 8,
        "y": 2
      },
      {
        "x": 8,
        "y": 11
      }
    ],
    "aggression": 0.63,
    "scentBias": 0.75,
    "hearingBias": 0.53,
    "campHoleChance": 0.1,
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
  "ambient": 0.48,
  "difficulty": 3.7,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "galleries",
    "arcade",
    "solo-cat",
    "q5"
  ]
};

export default stage;
