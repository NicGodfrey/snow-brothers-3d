import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s04-neon-puddle",
  "chapter": 3,
  "index": 4,
  "name": "Neon Puddle",
  "theme": "alley",
  "kind": "story",
  "seed": 1338860298,
  "width": 21,
  "height": 15,
  "tileSize": 16,
  "tiles": [
    "#####################",
    "#...................#",
    "#....g.##...........#",
    "#................g..#",
    "#......##...........#",
    "#......##...........#",
    "#......##...........#",
    "#......##...........#",
    "#......##...........#",
    "#....g.##.......g...#",
    "#......##...........#",
    "#......##...........#",
    "#......##...........#",
    "#......##..........o#",
    "#####################"
  ],
  "decor": [
    "    +                ",
    " +   .`,=*+   .`,=*+ ",
    " `,=*+   .`,=*+   .` ",
    "    .`,=*+   .`,=*+  ",
    " ,=*+    `,=*+   .`, ",
    "   .`,=     .`,=*+   ",
    " =*+     ,=*+   .`,= ",
    "+ .`,=*    .`,=*+    ",
    " *+   .  =*+   .`,=* ",
    " .`,=*+   .`,=*+   . ",
    " +   .`+ *+   .`,=*+ ",
    " `,=*+   .`,=*+   .` ",
    "    .`,  +   .`,=*+  ",
    " ,=*+    `,=*+   .`, ",
    " + +           +     "
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
      "id": "ch03-s04-neon-puddle-hole"
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 3,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 9,
      "y": 8,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 13,
      "y": 10,
      "value": 1,
      "guarded": true
    },
    {
      "type": "cheese",
      "x": 8,
      "y": 1,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 15,
      "y": 6,
      "breed": "calico",
      "patrol": 1,
      "facing": 0.61
    },
    {
      "type": "powerUp",
      "x": 14,
      "y": 2,
      "kind": "speed"
    },
    {
      "type": "hazard",
      "x": 15,
      "y": 9,
      "kind": "fan"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 10,
      "note": "dumpster"
    }
  ],
  "lights": [
    {
      "x": 3,
      "y": 7,
      "radius": 3.5,
      "intensity": 0.56,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 3,
      "radius": 5.2,
      "intensity": 0.58,
      "flicker": 0.2,
      "on": true
    },
    {
      "x": 17,
      "y": 3,
      "radius": 5.3,
      "intensity": 0.44,
      "flicker": 0,
      "on": true
    },
    {
      "x": 6,
      "y": 6,
      "radius": 5.2,
      "intensity": 0.68,
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
      "pauseSeconds": 1.51,
      "points": [
        {
          "x": 15,
          "y": 6
        },
        {
          "x": 14,
          "y": 2
        },
        {
          "x": 15,
          "y": 9
        },
        {
          "x": 11,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Neon Puddle. The fire escape keeps a second set of books."
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
      "line": "Sneak the fire escape. Dash is postage. The dual layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the fire escape. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
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
      "line": "Neon Puddle banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The fire escape keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the fire escape considers creaking.",
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
        "x": 13,
        "y": 3
      }
    ],
    "searchSpots": [
      {
        "x": 13,
        "y": 3
      },
      {
        "x": 2,
        "y": 6
      },
      {
        "x": 9,
        "y": 8
      },
      {
        "x": 13,
        "y": 10
      }
    ],
    "aggression": 0.61,
    "scentBias": 0.56,
    "hearingBias": 0.59,
    "campHoleChance": 0.14,
    "leashRadius": 9
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
  "parTime": 126,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 2.9,
  "music": "alley-neon",
  "tags": [
    "alley",
    "dual",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
