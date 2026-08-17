import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s03-cotton-stall",
  "chapter": 6,
  "index": 3,
  "name": "Cotton Stall",
  "theme": "carnival",
  "kind": "story",
  "seed": 2899689429,
  "width": 21,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#......##...........#",
    "#.r....##...........#",
    "#......##.........D.#",
    "#...............r...#",
    "#......##...........#",
    "#......##...........#",
    "#...................#",
    "#......##...........#",
    "#...T..##...........#",
    "#......##...........#",
    "#.....r##.......r...#",
    "#......##...........#",
    "#..................o#",
    "#####################"
  ],
  "decor": [
    "                     ",
    " +   .`,=*+   .`,=*++",
    " `,=*+ + .`,=*+   .` ",
    "    .`,  +   .`,=*+  ",
    " ,=*+   +`,=*+   . , ",
    "   .`,=*+   .`,=*+   ",
    " =*+   + ,=*+   .`,= ",
    "+ .`,=*    .`,=*+    ",
    " *+   .`,=*+   .`,=* ",
    " .`,=*+   .`,=*+   . ",
    " +   .`  *+   .`,=*+ ",
    " `,=*+   .`,=*+   .` ",
    "    .`,  +   .`,=*+ +",
    " ,=*+    `,=*+   .`, ",
    "   .`,=*+   .`,=*+   ",
    "      +         +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 14,
      "id": "ch06-s03-cotton-stall-hole"
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
      "x": 14,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 4,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 3,
      "y": 3,
      "breed": "siamese",
      "patrol": 1,
      "facing": 5.74
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 8,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 3,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 10,
      "kind": "fan"
    },
    {
      "type": "key",
      "x": 9,
      "y": 3,
      "keyId": "ch06-s03-cotton-stall-key"
    },
    {
      "type": "door",
      "x": 18,
      "y": 4,
      "id": "ch06-s03-cotton-stall-door",
      "locked": true,
      "keyId": "ch06-s03-cotton-stall-key"
    },
    {
      "type": "decorProp",
      "x": 2,
      "y": 7,
      "note": "mirrors"
    }
  ],
  "lights": [
    {
      "x": 5,
      "y": 5,
      "radius": 5.3,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 5,
      "y": 10,
      "radius": 4.8,
      "intensity": 0.64,
      "flicker": 0.29,
      "on": true
    },
    {
      "x": 16,
      "y": 14,
      "radius": 4,
      "intensity": 0.44,
      "flicker": 0.14,
      "on": true
    },
    {
      "x": 19,
      "y": 14,
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
      "pauseSeconds": 1.04,
      "points": [
        {
          "x": 3,
          "y": 3
        },
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 15,
          "y": 3
        },
        {
          "x": 14,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Cotton Stall. The bumper keeps a second set of books."
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
      "line": "Sneak the bumper. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the bumper. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in carnival. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 5. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Cotton Stall banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The bumper keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the bumper considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 13
      },
      {
        "x": 5,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 5,
        "y": 3
      },
      {
        "x": 14,
        "y": 7
      },
      {
        "x": 3,
        "y": 2
      },
      {
        "x": 4,
        "y": 8
      }
    ],
    "aggression": 0.82,
    "scentBias": 0.57,
    "hearingBias": 0.81,
    "campHoleChance": 0.21,
    "leashRadius": 12
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
  "parTime": 136,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 4.9,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "dual",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
