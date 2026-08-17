import { DEFAULT_CAT_STATS, DEFAULT_CAT_WEIGHTS, DEFAULT_MOUSE_STATS } from '../../src/game/defaults';
import { createMouse } from '../../src/game/mouse';
import type { CatRuntime, MouseRuntime } from '../../src/game/types';

export function makeTestMouse(x = 2, y = 2, extra: Partial<MouseRuntime> = {}): MouseRuntime {
  const mouse = createMouse(1, x, y, DEFAULT_MOUSE_STATS, 3);
  return Object.assign(mouse, extra);
}

export function makeTestCat(x = 6, y = 2, extra: Partial<CatRuntime> = {}): CatRuntime {
  return {
    entity: 2,
    transform: { x, y, vx: 0, vy: 0, facing: 0, radius: 0.38 },
    state: 'patrol',
    breed: 'tabby',
    stats: { ...DEFAULT_CAT_STATS },
    weights: { ...DEFAULT_CAT_WEIGHTS },
    suspicion: 0,
    stateTimer: 0,
    pounceCooldown: 0,
    frozen: 0,
    target: null,
    lastKnown: null,
    memoryTimer: 0,
    patrolRoute: [],
    patrolIndex: 0,
    path: [],
    pathIndex: 0,
    repathTimer: 0,
    searchSpots: [],
    homeX: x,
    homeY: y,
    statuses: [],
    ...extra,
  };
}
