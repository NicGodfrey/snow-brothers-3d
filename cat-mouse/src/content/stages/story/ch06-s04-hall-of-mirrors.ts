import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch06-s04-hall-of-mirrors",
  "chapter": 6,
  "index": 4,
  "name": "Hall Of Mirrors",
  "theme": "carnival",
  "kind": "story",
  "seed": 392881601,
  "width": 20,
  "height": 12,
  "tileSize": 16,
  "tiles": [
    "####################",
    "#..................#",
    "#.r......r.........#",
    "#..................#",
    "#.TGGGGGX..........#",
    "#.TGGGGGX.......r..#",
    "#.TGGGGGX..........#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..............D..o#",
    "####################"
  ],
  "decor": [
    "                    ",
    "    .`,=*+   .`,=*+ ",
    " ,=*+   .`,=*+   .` ",
    "   .`,=*+   .`,=*+  ",
    " = +   . ,=*+   .`, ",
    "   `,=*+   .`,=*+   ",
    " *    .` =*+   .`,= ",
    " .`,=*+   .`,=*+    ",
    " +   .`,=*+   .`,=* ",
    " `,=*+   .`,=*+   . ",
    "    .`,=*+   .` =*+ ",
    "                  + "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 18,
      "y": 10,
      "id": "ch06-s04-hall-of-mirrors-hole"
    },
    {
      "type": "cheese",
      "x": 6,
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
      "x": 17,
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
      "x": 18,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 3,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 6,
      "y": 8,
      "breed": "calico",
      "patrol": 1,
      "facing": 2.43
    },
    {
      "type": "powerUp",
      "x": 11,
      "y": 5,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 3,
      "kind": "fan"
    },
    {
      "type": "hazard",
      "x": 18,
      "y": 5,
      "kind": "glueBoard"
    },
    {
      "type": "key",
      "x": 5,
      "y": 9,
      "keyId": "ch06-s04-hall-of-mirrors-key"
    },
    {
      "type": "door",
      "x": 15,
      "y": 10,
      "id": "ch06-s04-hall-of-mirrors-door",
      "locked": true,
      "keyId": "ch06-s04-hall-of-mirrors-key"
    },
    {
      "type": "decorProp",
      "x": 4,
      "y": 4,
      "note": "booth"
    }
  ],
  "lights": [
    {
      "x": 12,
      "y": 2,
      "radius": 4.2,
      "intensity": 0.63,
      "flicker": 0.16,
      "on": true
    },
    {
      "x": 3,
      "y": 4,
      "radius": 4,
      "intensity": 0.82,
      "flicker": 0.25,
      "on": true
    },
    {
      "x": 18,
      "y": 10,
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
      "pauseSeconds": 0.48,
      "points": [
        {
          "x": 6,
          "y": 8
        },
        {
          "x": 11,
          "y": 5
        },
        {
          "x": 14,
          "y": 3
        },
        {
          "x": 18,
          "y": 5
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Hall Of Mirrors. The booth keeps a second set of books."
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
      "line": "Sneak the booth. Dash is postage. The islands layout lies about shortcuts.",
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
      "line": "Half of 5. islands heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Hall Of Mirrors banked. Whiskers attached."
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
        "x": 18,
        "y": 9
      },
      {
        "x": 6,
        "y": 7
      }
    ],
    "searchSpots": [
      {
        "x": 6,
        "y": 7
      },
      {
        "x": 3,
        "y": 8
      },
      {
        "x": 17,
        "y": 8
      },
      {
        "x": 16,
        "y": 1
      }
    ],
    "aggression": 0.73,
    "scentBias": 0.41,
    "hearingBias": 0.69,
    "campHoleChance": 0.12,
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
  "parTime": 126,
  "lives": 3,
  "ambient": 0.48,
  "difficulty": 5,
  "music": "carnival-closed",
  "tags": [
    "carnival",
    "islands",
    "story",
    "solo-cat",
    "q5"
  ]
};

export default stage;
