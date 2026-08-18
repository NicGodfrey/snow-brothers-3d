import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-22-quota-fever",
  "chapter": 0,
  "index": 22,
  "name": "Quota Fever",
  "theme": "greenhouse",
  "kind": "arcade",
  "seed": 2078230588,
  "width": 18,
  "height": 11,
  "tileSize": 16,
  "tiles": [
    "##################",
    "#................#",
    "#......T...X.....#",
    "#................#",
    "#####.######.....#",
    "#..r.............#",
    "#...G....T....X..#",
    "#................#",
    "#................#",
    "#...............o#",
    "##################"
  ],
  "decor": [
    "        +         ",
    " `,=*+   .`,=*+   ",
    "    .`, *+ = .`,=+",
    " ,=*+   .`,=*+    ",
    " +   ,+     .`,=* ",
    " =*+   .`,=*+   . ",
    "  .`,=*+ = .`, *+ ",
    " *+   .`,=*+   .` ",
    " .`,=*+   .`,=*+  ",
    " +   .`,=*+   .`, ",
    "     +            "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 16,
      "y": 9,
      "id": "arcade-22-quota-fever-hole"
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 8,
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
      "x": 5,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 1,
      "y": 6,
      "breed": "calico",
      "patrol": 1,
      "facing": 5.27
    },
    {
      "type": "cat",
      "x": 2,
      "y": 9,
      "breed": "scottishFold",
      "patrol": 2,
      "facing": 0.94
    },
    {
      "type": "powerUp",
      "x": 2,
      "y": 3,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 8,
      "y": 8,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 2,
      "note": "orchids"
    }
  ],
  "lights": [
    {
      "x": 11,
      "y": 9,
      "radius": 3.9,
      "intensity": 0.75,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 8,
      "radius": 4.8,
      "intensity": 0.7,
      "flicker": 0,
      "on": true
    },
    {
      "x": 16,
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
      "pauseSeconds": 0.79,
      "points": [
        {
          "x": 1,
          "y": 6
        },
        {
          "x": 2,
          "y": 3
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 2,
          "y": 9
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 1.25,
      "points": [
        {
          "x": 2,
          "y": 9
        },
        {
          "x": 2,
          "y": 3
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 8,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Quota Fever. The seedlings keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 5. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the seedlings. Dash is postage. The galleries layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the seedlings. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in greenhouse. Verbs are edible."
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
      "line": "Quota Fever banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The seedlings keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the seedlings considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 16,
        "y": 8
      },
      {
        "x": 15,
        "y": 8
      }
    ],
    "searchSpots": [
      {
        "x": 15,
        "y": 8
      },
      {
        "x": 3,
        "y": 2
      },
      {
        "x": 5,
        "y": 5
      },
      {
        "x": 14,
        "y": 5
      }
    ],
    "aggression": 0.6,
    "scentBias": 0.8,
    "hearingBias": 0.69,
    "campHoleChance": 0.26,
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
  "parTime": 129,
  "lives": 3,
  "ambient": 0.5,
  "difficulty": 5.6,
  "music": "greenhouse-hum",
  "tags": [
    "greenhouse",
    "galleries",
    "arcade",
    "multi-cat",
    "q5"
  ]
};

export default stage;
