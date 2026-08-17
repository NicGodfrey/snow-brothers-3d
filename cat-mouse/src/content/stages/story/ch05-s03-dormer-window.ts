import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch05-s03-dormer-window",
  "chapter": 5,
  "index": 3,
  "name": "Dormer Window",
  "theme": "attic",
  "kind": "story",
  "seed": 2158307427,
  "width": 21,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#...................#",
    "#......##v..........#",
    "#...................#",
    "#......##...........#",
    "#.D.................#",
    "#...................#",
    "#......r............#",
    "#..................o#",
    "#####################"
  ],
  "decor": [
    "+  +                 ",
    " +   .`,=*+   .`,=*+ ",
    " `,=*+   .`,=*+   .` ",
    "    .`,  +   .`,=*+  ",
    " ,=*+   .`,=*+   .`, ",
    "   .`,=     .`,=*+   ",
    " = +   .`,=*+   .`,=+",
    "  .`,=*+   .`,=*+    ",
    " *+   .`,=*+   .`,=* ",
    " .`,=*+   .`,=*+   . ",
    "   +  +              "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 9,
      "id": "ch05-s03-dormer-window-hole"
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 4,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 7,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 15,
      "y": 8,
      "breed": "ragdoll",
      "patrol": 1,
      "facing": 2.63
    },
    {
      "type": "powerUp",
      "x": 8,
      "y": 8,
      "kind": "invisibility"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 1,
      "kind": "broom"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 3,
      "kind": "broom"
    },
    {
      "type": "key",
      "x": 6,
      "y": 3,
      "keyId": "ch05-s03-dormer-window-key"
    },
    {
      "type": "door",
      "x": 2,
      "y": 6,
      "id": "ch05-s03-dormer-window-door",
      "locked": true,
      "keyId": "ch05-s03-dormer-window-key"
    }
  ],
  "lights": [
    {
      "x": 6,
      "y": 9,
      "radius": 5.3,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 9,
      "radius": 3.7,
      "intensity": 0.89,
      "flicker": 0,
      "on": true
    },
    {
      "x": 9,
      "y": 5,
      "radius": 5.7,
      "intensity": 0.76,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "pauseSeconds": 0.55,
      "points": [
        {
          "x": 15,
          "y": 8
        },
        {
          "x": 8,
          "y": 8
        },
        {
          "x": 11,
          "y": 1
        },
        {
          "x": 14,
          "y": 3
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Dormer Window. The dormer keeps a second set of books."
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
      "line": "Sneak the dormer. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the dormer. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
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
      "line": "Dormer Window banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The dormer keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the dormer considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 8
      },
      {
        "x": 15,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 15,
        "y": 6
      },
      {
        "x": 6,
        "y": 8
      },
      {
        "x": 16,
        "y": 1
      },
      {
        "x": 3,
        "y": 4
      }
    ],
    "aggression": 0.78,
    "scentBias": 0.85,
    "hearingBias": 0.43,
    "campHoleChance": 0.14,
    "leashRadius": 11
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
  "parTime": 125,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 4.2,
  "music": "attic-moths",
  "tags": [
    "attic",
    "dual",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
