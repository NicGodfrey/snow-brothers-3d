import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch02-s08-locked-hatch",
  "chapter": 2,
  "index": 8,
  "name": "Locked Hatch",
  "theme": "cellar",
  "kind": "story",
  "seed": 1426531796,
  "width": 21,
  "height": 17,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#.........##........#",
    "#.........##........#",
    "#..T......##...s....#",
    "#.........##........#",
    "#...................#",
    "#.........##........#",
    "#.r.......##...~....#",
    "#.........##........#",
    "#.........##........#",
    "#.........##........#",
    "#...................#",
    "#.........##........#",
    "#.........##........#",
    "#..................o#",
    "#####################"
  ],
  "decor": [
    "                +    ",
    " .`,=*+   .`,=*+   . ",
    " +   .`,=*    .`,=*+ ",
    " `,=*+   .  =*+   .` ",
    "    .`,=*+   .`,=*+  ",
    " ,=*+   .`  *+   .`, ",
    "   .`,=*+   .`,=*+   ",
    " =*+   .`,  +   .`,= ",
    "  .`,=*+    `,=*+    ",
    " *+   .`,=     .`,=* ",
    " .`,=*+     ,=*+   . ",
    " +   .`,=*    .`,=*+ ",
    " `,=*+   .`,=*+   .`+",
    "    .`,=*+   .`,=*+  ",
    " ,=*+   .`  *+   .`,+",
    "   .`,=*+   .`,=*+   ",
    "+      +             "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 19,
      "y": 15,
      "id": "ch02-s08-locked-hatch-hole"
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 12,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 19,
      "y": 6,
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
      "x": 13,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 17,
      "y": 15,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 16,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 7,
      "y": 11,
      "breed": "tabby",
      "patrol": 1,
      "facing": 0.43
    },
    {
      "type": "powerUp",
      "x": 4,
      "y": 15,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 14,
      "y": 2,
      "kind": "glueBoard"
    },
    {
      "type": "decorProp",
      "x": 2,
      "y": 12,
      "note": "furnace"
    }
  ],
  "lights": [
    {
      "x": 4,
      "y": 11,
      "radius": 4.3,
      "intensity": 0.76,
      "flicker": 0,
      "on": true
    },
    {
      "x": 15,
      "y": 3,
      "radius": 3.9,
      "intensity": 0.83,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 8,
      "radius": 5.6,
      "intensity": 0.48,
      "flicker": 0,
      "on": true
    },
    {
      "x": 17,
      "y": 8,
      "radius": 4.5,
      "intensity": 0.45,
      "flicker": 0.34,
      "on": true
    },
    {
      "x": 19,
      "y": 15,
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
      "pauseSeconds": 0.63,
      "points": [
        {
          "x": 7,
          "y": 11
        },
        {
          "x": 4,
          "y": 15
        },
        {
          "x": 14,
          "y": 2
        },
        {
          "x": 2,
          "y": 12
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Locked Hatch. The wine rack keeps a second set of books."
    },
    {
      "at": "enter",
      "speaker": "Squeak",
      "line": "Quota 4. One hunter. Hole at the far south.",
      "delay": 0.4
    },
    {
      "at": "enter",
      "speaker": "Gran",
      "line": "Sneak the wine rack. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the wine rack. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in cellar. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. dual heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Locked Hatch banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The wine rack keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the wine rack considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 19,
        "y": 14
      },
      {
        "x": 19,
        "y": 12
      }
    ],
    "searchSpots": [
      {
        "x": 19,
        "y": 12
      },
      {
        "x": 19,
        "y": 6
      },
      {
        "x": 8,
        "y": 6
      },
      {
        "x": 13,
        "y": 15
      }
    ],
    "aggression": 0.52,
    "scentBias": 0.84,
    "hearingBias": 0.77,
    "campHoleChance": 0.21,
    "leashRadius": 8
  },
  "objectives": [
    {
      "kind": "quota",
      "value": 4,
      "optional": false,
      "label": "Bank 4 cheese"
    },
    {
      "kind": "noCatch",
      "value": 1,
      "optional": true,
      "label": "Ghost clear"
    }
  ],
  "quota": 4,
  "parTime": 130,
  "lives": 3,
  "ambient": 0.28,
  "difficulty": 2.7,
  "music": "cellar-drip",
  "tags": [
    "cellar",
    "dual",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
