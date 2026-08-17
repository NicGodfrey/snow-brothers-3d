# Cat & Mouse — Chase Protocol

Playable browser game. The mouse steals cheese; the cat hunts. Target: a real, large TypeScript codebase (~100,000 lines of *actual* game code, data, and tests — no comment padding, no copy-paste twins, no empty stubs counted as content).

## Stack

- TypeScript 5.9, Vite 6, ESM
- HTML5 Canvas 2D custom engine (no Three.js — keep this tree independent of `stage-11/`)
- No runtime framework. Tests: Node built-in test runner (`node --test`) against compiled or tsx-free pure modules where possible
- Package root: `/workspace/cat-mouse`
- Dev: `npm install && npm run dev`
- Build: `npm run build`
- Test: `npm test`

## Player fantasy

You are **Squeak** (mouse). **Pounce** (cat) is the hunter AI. Cheese is score. Holes are exits. Traps, lights, crumbs, and power-ups change the hunt.

Controls:

- WASD / arrows — move
- Shift — sneak (quieter, slower; smaller scent)
- Space — dash (stamina)
- E — interact (hole, switch, steal cheese, drop decoy)
- Q — drop crumb decoy (if inventory)
- F — use held power-up
- Esc — pause
- M — mute

Win a stage by depositing N cheese in the mouse hole before the cat lands three catches (lives). Catch = cat overlap while mouse is not invulnerable; respawn at last hole / start.

## Game modes

1. `story` — 12 chapters, 8 stages each (96 story stages)
2. `arcade` — endless escalating hunt
3. `timeAttack` — one stage, clock
4. `mirror` — play as the cat (AI mouse)
5. `hotseat` — two players, one keyboard (cat WASD, mouse arrows) or shared
6. `sandbox` — free roam + debug overlays

## Engine modules (`src/engine/`)

Must be real systems with tests, not facades:

- ECS (entities, components, systems, queries, prefabs)
- Fixed-timestep loop, scene stack, asset loader
- 2D renderer (sprite batches, camera, lighting overlay, fog-of-war, particles)
- Physics (AABB, circles, tiles, triggers, one-way platforms)
- Input (bindings, rebind, replay buffer)
- Audio (bus, ducking, spatial falloff — oscillators + optional buffers)
- Pathfinding (A*, JPS optional, flow fields for cat pack)
- Steering, influence maps, scent fields
- RNG (seeded), save/load, replay, achievements
- Debug HUD, frame graph, spatial hash

## Gameplay modules (`src/game/`)

- Mouse controller, stamina, sneak, inventory
- Cat AI: sight cone, hearing, scent, investigate, search pattern, ambush, pounce lunge
- Cheese, holes, traps, lights, switches, doors, vents
- Power-ups: speed, invisibility, freeze, decoy, extra life, noise bomb, magnet
- Scoring, stars, heat, combo
- Director (spawns, difficulty curve)
- Status effects, buffs/debuffs

## Content (`src/content/`)

- 96 story stages + 24 arcade seeds + 12 time-attack layouts
- Each stage is a real module: tiles, entities, lighting, AI hints, cheese quota, dialogue beats
- Item catalog, cat breed catalog (behavior weights), dialogue trees, achievement table
- Shared tile atlas descriptors and palette themes (cellar, kitchen, alley, sewer, attic, carnival, museum, subway, docks, greenhouse, clocktower, moon-lab)

## UI (`src/ui/`)

Boot, title, mode select, chapter map, HUD, pause, settings, results, credits, tutorial overlay. All keyboard-reachable.

## Tests (`tests/`)

Unit tests for math, ECS, physics, pathfinding, scent, AI state machine, scoring, save schema, stage loaders. Integration tests for a few stages (win condition reachable, cat can catch, cheese deposit works).

## Quality bar

- `npm run build` succeeds
- `npm test` succeeds
- Title → Story → Stage 1 is playable in `npm run dev`
- Cat hunts; mouse can sneak, dash, steal, deposit
- No `TODO: implement later` in shipped systems
- No duplicated files whose only difference is a renamed constant
- Generated content must vary in layout, theme, and AI hints

## Line-count policy

Count `src/**/*.ts`, `tests/**/*.ts` after excluding `node_modules` and lockfiles. Prefer real data and real logic. If a generator can emit unique stages, check the generator *and* the emitted modules in. Do not inflate with block comments or repeated `export const x = 1` files.
