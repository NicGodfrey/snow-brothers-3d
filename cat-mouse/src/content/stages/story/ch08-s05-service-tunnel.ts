import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch08-s05-service-tunnel",
  "chapter": 8,
  "index": 5,
  "name": "Service Tunnel",
  "theme": "subway",
  "kind": "story",
  "seed": 1279562629,
  "width": 21,
  "height": 13,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#..D.......##.......#",
    "#..........##.......#",
    "#...................#",
    "#.......X..##.......#",
    "#..........##.......#",
    "#..........##.......#",
    "#............g......#",
    "#..........##.......#",
    "#...X......##.......#",
    "#..........##......o#",
    "#####################"
  ],
  "decor": [
    "     +               ",
    " *+   .`,=*+   .`,=* ",
    " .` =*+   .  =*+   . ",
    " +   .`,=*+   .`,=*+ ",
    " `,=*+   .`,=*+   .` ",
    "    .`,= +   .`,=*+  ",
    " ,=*+   .`,  +   .`, ",
    "   .`,=*+    `,=*+   ",
    " =*+   .`,=*+   .`,= ",
    "  .`,=*+     ,=*+    ",
    " *+   .`,=*    .`,=* ",
    " .`,=*+   .  =*+   . ",
    "                  + +"
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 11,
      "id": "ch08-s05-service-tunnel-hole"
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 3,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 10,
      "y": 2,
      "breed": "savannah",
      "patrol": 1,
      "facing": 1.69
    },
    {
      "type": "cat",
      "x": 4,
      "y": 5,
      "breed": "siamese",
      "patrol": 2,
      "facing": 1.09
    },
    {
      "type": "powerUp",
      "x": 10,
      "y": 7,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 17,
      "y": 10,
      "kind": "sparkWire"
    },
    {
      "type": "key",
      "x": 13,
      "y": 8,
      "keyId": "ch08-s05-service-tunnel-key"
    },
    {
      "type": "door",
      "x": 3,
      "y": 2,
      "id": "ch08-s05-service-tunnel-door",
      "locked": true,
      "keyId": "ch08-s05-service-tunnel-key"
    },
    {
      "type": "decorProp",
      "x": 14,
      "y": 4,
      "note": "third rail"
    }
  ],
  "lights": [
    {
      "x": 8,
      "y": 3,
      "radius": 5.4,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 3,
      "y": 5,
      "radius": 4.3,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 7,
      "y": 6,
      "radius": 6.2,
      "intensity": 0.8,
      "flicker": 0,
      "on": true
    },
    {
      "x": 2,
      "y": 10,
      "radius": 3.9,
      "intensity": 0.75,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "loop": false,
      "pauseSeconds": 1.02,
      "points": [
        {
          "x": 10,
          "y": 2
        },
        {
          "x": 17,
          "y": 10
        },
        {
          "x": 4,
          "y": 5
        },
        {
          "x": 10,
          "y": 7
        }
      ]
    },
    {
      "id": 2,
      "loop": false,
      "pauseSeconds": 0.71,
      "points": [
        {
          "x": 4,
          "y": 5
        },
        {
          "x": 17,
          "y": 10
        },
        {
          "x": 10,
          "y": 7
        },
        {
          "x": 13,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Service Tunnel. The turnstile keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 6. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Radio",
      "line": "Sneak the turnstile. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the turnstile. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in subway. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 6. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Service Tunnel banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The turnstile keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the turnstile considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 10
      },
      {
        "x": 16,
        "y": 10
      }
    ],
    "searchSpots": [
      {
        "x": 16,
        "y": 10
      },
      {
        "x": 16,
        "y": 3
      },
      {
        "x": 1,
        "y": 8
      },
      {
        "x": 16,
        "y": 7
      }
    ],
    "aggression": 0.82,
    "scentBias": 0.53,
    "hearingBias": 0.78,
    "campHoleChance": 0.29,
    "leashRadius": 14
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 6,
      "optional": false,
      "label": "Bank 6 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 6,
  "parTime": 144,
  "lives": 3,
  "ambient": 0.36,
  "difficulty": 6.5,
  "music": "subway-last",
  "tags": [
    "subway",
    "dual",
    "story",
    "multi-cat",
    "q6"
  ]
};

export default stage;
