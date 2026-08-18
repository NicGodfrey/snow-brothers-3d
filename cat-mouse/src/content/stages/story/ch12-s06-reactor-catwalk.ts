import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch12-s06-reactor-catwalk",
  "chapter": 12,
  "index": 6,
  "name": "Reactor Catwalk",
  "theme": "moonLab",
  "kind": "story",
  "seed": 3508115702,
  "width": 21,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#..D................#",
    "#...............##..#",
    "#..#######.#######..#",
    "#..#######.#######..#",
    "#..#######.#######..#",
    "#...................#",
    "#..#######.#######..#",
    "#...######.#######..#",
    "#..#######.#######..#",
    "#..#######.#.#####..#",
    "#...................#",
    "#..................o#",
    "#####################"
  ],
  "decor": [
    "                     ",
    " =*+   .`,=*+   .`,= ",
    "  . ,=*+   .`,=*+    ",
    " *+   .`,=*+   .  =* ",
    " .`       .     +  . ",
    "++     +  +    +  *+ ",
    " `,       ` +     .` ",
    "    .`,=*+   .`,=*+  ",
    " ,=      +,       `, ",
    "   .                +",
    " =*     + =    +  ,= ",
    "  .         `        ",
    " *+   .`,=*+   .`,=* ",
    " .`,=*+   .`,=*+   . ",
    "+   + +              "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 13,
      "id": "ch12-s06-reactor-catwalk-hole"
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 1,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 13,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 14,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 11,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 12,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 10,
      "y": 12,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 15,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cat",
      "x": 1,
      "y": 7,
      "breed": "siamese",
      "patrol": 1,
      "facing": 6.22
    },
    {
      "type": "cat",
      "x": 2,
      "y": 9,
      "breed": "britishShorthair",
      "patrol": 2,
      "facing": 1.47
    },
    {
      "type": "powerUp",
      "x": 18,
      "y": 11,
      "kind": "freeze"
    },
    {
      "type": "hazard",
      "x": 11,
      "y": 13,
      "kind": "sparkWire"
    },
    {
      "type": "hazard",
      "x": 3,
      "y": 9,
      "kind": "vacuum"
    },
    {
      "type": "key",
      "x": 1,
      "y": 4,
      "keyId": "ch12-s06-reactor-catwalk-key"
    },
    {
      "type": "door",
      "x": 3,
      "y": 2,
      "id": "ch12-s06-reactor-catwalk-door",
      "locked": true,
      "keyId": "ch12-s06-reactor-catwalk-key"
    },
    {
      "type": "decorProp",
      "x": 13,
      "y": 12,
      "note": "vault"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 13,
      "radius": 5.8,
      "intensity": 0.77,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 6,
      "radius": 5.7,
      "intensity": 0.88,
      "flicker": 0.21,
      "on": true
    },
    {
      "x": 4,
      "y": 12,
      "radius": 4.2,
      "intensity": 0.5,
      "flicker": 0,
      "on": true
    },
    {
      "x": 11,
      "y": 1,
      "radius": 6.1,
      "intensity": 0.69,
      "flicker": 0,
      "on": true
    },
    {
      "x": 19,
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
      "pauseSeconds": 0.89,
      "points": [
        {
          "x": 1,
          "y": 7
        },
        {
          "x": 18,
          "y": 11
        },
        {
          "x": 2,
          "y": 9
        },
        {
          "x": 11,
          "y": 13
        }
      ]
    },
    {
      "id": 2,
      "loop": true,
      "pauseSeconds": 1.2,
      "points": [
        {
          "x": 2,
          "y": 9
        },
        {
          "x": 18,
          "y": 11
        },
        {
          "x": 11,
          "y": 13
        },
        {
          "x": 1,
          "y": 4
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Reactor Catwalk. The vault keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 9. 2 hunters. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the vault. Dash is postage. The ring layout lies about shortcuts.",
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
      "line": "Half of 9. ring heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Reactor Catwalk banked. Whiskers attached."
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
        "x": 19,
        "y": 12
      },
      {
        "x": 17,
        "y": 1
      }
    ],
    "searchSpots": [
      {
        "x": 17,
        "y": 1
      },
      {
        "x": 8,
        "y": 13
      },
      {
        "x": 15,
        "y": 1
      },
      {
        "x": 14,
        "y": 12
      }
    ],
    "aggression": 1.14,
    "scentBias": 0.41,
    "hearingBias": 0.58,
    "campHoleChance": 0.3,
    "leashRadius": 18
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 9,
      "optional": false,
      "label": "Bank 9 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 9,
  "parTime": 173,
  "lives": 2,
  "ambient": 0.7,
  "difficulty": 9.4,
  "music": "moonlab-protocol",
  "tags": [
    "moonLab",
    "ring",
    "story",
    "multi-cat",
    "q9"
  ]
};

export default stage;
