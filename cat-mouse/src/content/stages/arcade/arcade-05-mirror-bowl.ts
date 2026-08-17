import type { StageDef } from '../../schema';

const stage: StageDef = {
  "id": "arcade-05-mirror-bowl",
  "chapter": 0,
  "index": 5,
  "name": "Mirror Bowl",
  "theme": "attic",
  "kind": "arcade",
  "seed": 544458785,
  "width": 18,
  "height": 16,
  "tileSize": 16,
  "tiles": [
    "##################",
    "#................#",
    "#........r.......#",
    "#................#",
    "#.####.#########.#",
    "#................#",
    "#................#",
    "#................#",
    "#.#########.####.#",
    "#........r.r.....#",
    "#............X...#",
    "#....r..........o#",
    "##################",
    "##################",
    "##################",
    "##################"
  ],
  "decor": [
    "    +             ",
    " =*+   .`,=*+   . ",
    "  .`,=*+   .`,=*+ ",
    " *+   .`,=*+   .` ",
    " .    +           ",
    " +   .`,=*+   .`, ",
    " `,=*+   .`,=*+   ",
    "+   .`,=*+   .`,= ",
    " ,         =++    ",
    "+  .`,=*+   .`,=* ",
    " =*+   .`,=*+   . ",
    "  .`,=*+   .`,=*+ ",
    "                + ",
    "+             +   ",
    "          +       ",
    " +  +            +"
  ],
  "spawn": {
    "x": 1,
    "y": 1
  },
  "entities": [
    {
      "type": "hole",
      "x": 16,
      "y": 11,
      "id": "arcade-05-mirror-bowl-hole"
    },
    {
      "type": "cheese",
      "x": 1,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 11,
      "y": 10,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 7,
      "y": 9,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 5,
      "y": 6,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cheese",
      "x": 2,
      "y": 2,
      "value": 1,
      "guarded": false
    },
    {
      "type": "cat",
      "x": 15,
      "y": 3,
      "breed": "scottishFold",
      "patrol": 1,
      "facing": 4.08
    },
    {
      "type": "powerUp",
      "x": 13,
      "y": 5,
      "kind": "decoy"
    },
    {
      "type": "hazard",
      "x": 16,
      "y": 3,
      "kind": "snapTrap"
    },
    {
      "type": "decorProp",
      "x": 1,
      "y": 2,
      "note": "chimney"
    }
  ],
  "lights": [
    {
      "x": 2,
      "y": 10,
      "radius": 5.7,
      "intensity": 0.64,
      "flicker": 0,
      "on": true
    },
    {
      "x": 12,
      "y": 2,
      "radius": 4.1,
      "intensity": 0.57,
      "flicker": 0,
      "on": true
    },
    {
      "x": 13,
      "y": 3,
      "radius": 4.3,
      "intensity": 0.51,
      "flicker": 0.28,
      "on": true
    },
    {
      "x": 16,
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
      "pauseSeconds": 0.95,
      "points": [
        {
          "x": 15,
          "y": 3
        },
        {
          "x": 1,
          "y": 2
        },
        {
          "x": 13,
          "y": 5
        },
        {
          "x": 2,
          "y": 10
        }
      ]
    }
  ],
  "dialogue": [
    {
      "at": "enter",
      "speaker": "Narrator",
      "line": "Mirror Bowl. The chimney keeps a second set of books."
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
      "line": "Sneak the chimney. Dash is postage. The channels layout lies about shortcuts.",
      "delay": 0.9
    },
    {
      "at": "firstCheese",
      "speaker": "Squeak",
      "line": "Wedge by the chimney. Heavy. Mine until the hole says otherwise."
    },
    {
      "at": "firstSpotted",
      "speaker": "Pounce",
      "line": "I heard a verb in attic. Verbs are edible."
    },
    {
      "at": "halfQuota",
      "speaker": "Radio",
      "line": "Half of 4. channels heat is a kettle."
    },
    {
      "at": "lowLives",
      "speaker": "Gran",
      "line": "You dashed in a cone. That is not bravery."
    },
    {
      "at": "win",
      "speaker": "Squeak",
      "line": "Mirror Bowl banked. Whiskers attached."
    },
    {
      "at": "lose",
      "speaker": "Pounce",
      "line": "The chimney keeps what you could not."
    },
    {
      "at": "idle",
      "speaker": "Narrator",
      "line": "A board near the chimney considers creaking.",
      "delay": 8
    }
  ],
  "hints": {
    "ambushSpots": [
      {
        "x": 16,
        "y": 10
      },
      {
        "x": 1,
        "y": 6
      }
    ],
    "searchSpots": [
      {
        "x": 1,
        "y": 6
      },
      {
        "x": 11,
        "y": 10
      },
      {
        "x": 7,
        "y": 9
      },
      {
        "x": 5,
        "y": 6
      }
    ],
    "aggression": 0.69,
    "scentBias": 0.5,
    "hearingBias": 0.61,
    "campHoleChance": 0.09,
    "leashRadius": 10
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
  "parTime": 123,
  "lives": 3,
  "ambient": 0.4,
  "difficulty": 3.6,
  "music": "attic-moths",
  "tags": [
    "attic",
    "channels",
    "arcade",
    "solo-cat",
    "q4"
  ]
};

export default stage;
