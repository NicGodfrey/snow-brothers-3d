import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "ch03-s02-fire-escape",
  "chapter": 3,
  "index": 2,
  "name": "Fire Escape",
  "theme": "alley",
  "kind": "story",
  "seed": 3180099097,
  "width": 15,
  "height": 14,
  "tileSize": 16,
  "tiles": [
    "###############",
    "#.........#...#",
    "#.###...#.###.#",
    "#...#......g#.#",
    "#.#.#..#G...#.#",
    "#.#...........#",
    "#.##........#.#",
    "#...g......G#.#",
    "#.##........#.#",
    "#...p.......#.#",
    "#.#.##...####.#",
    "#............o#",
    "###############",
    "###############"
  ],
  "decor": [
    "       +++     ",
    "   .`,=*+   .` ",
    " =     . ,  +  ",
    "  .` =*+   . , ",
    " *    . ,=*+  +",
    " . ,=*+   .`,= ",
    " +   .`,=*+    ",
    " `,=*+   .`, * ",
    "    .`,=*+   . ",
    " ,=*+   .`,= + ",
    "   .  =*+    ` ",
    " =*+   .`,=*+  ",
    "          +    ",
    "          +    "
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 13,
      "y": 11,
      "id": "ch03-s02-fire-escape-hole"
    },
    {
      "type": "cheese",
      "x": 6,
      "y": 5,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 11,
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
      "x": 9,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 7,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 5,
      "y": 5,
      "breed": "siamese",
      "patrol": 1,
      "facing": 5.79
    },
    {
      "type": "powerUp",
      "x": 5,
      "y": 3,
      "kind": "noiseBomb"
    },
    {
      "type": "hazard",
      "x": 7,
      "y": 2,
      "kind": "broom"
    },
    {
      "type": "decorProp",
      "x": 11,
      "y": 8,
      "note": "neon"
    }
  ],
  "lights": [
    {
      "x": 10,
      "y": 3,
      "radius": 4.5,
      "intensity": 0.61,
      "flicker": 0,
      "on": true
    },
    {
      "x": 1,
      "y": 4,
      "radius": 5.3,
      "intensity": 0.9,
      "flicker": 0.34,
      "on": true
    },
    {
      "x": 9,
      "y": 5,
      "radius": 5.1,
      "intensity": 0.41,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
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
      "loop": true,
      "pauseSeconds": 0.42,
      "points": [
        {
          "x": 5,
          "y": 5
        },
        {
          "x": 5,
          "y": 3
        },
        {
          "x": 7,
          "y": 2
        },
        {
          "x": 11,
          "y": 8
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Fire Escape. The neon keeps a second set of books."
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
      "line": "Sneak the neon. Dash is postage. The maze layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the neon. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in alley. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. maze heat is a weather."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Fire Escape banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The neon keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the neon considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 13,
        "y": 10
      },
      {
        "x": 6,
        "y": 5
      }
    ],
    "searchSpots": [
      {
        "x": 6,
        "y": 5
      },
      {
        "x": 5,
        "y": 11
      },
      {
        "x": 1,
        "y": 8
      },
      {
        "x": 9,
        "y": 9
      }
    ],
    "aggression": 0.62,
    "scentBias": 0.8,
    "hearingBias": 0.35,
    "campHoleChance": 0.09,
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
  "parTime": 115,
  "lives": 3,
  "ambient": 0.34,
  "difficulty": 2.6,
  "music": "alley-neon",
  "tags": [
    "alley",
    "maze",
    "story",
    "solo-cat",
    "q4"
  ]
};

export default stage;
