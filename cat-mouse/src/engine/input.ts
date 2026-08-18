import type { InputAction, InputSnapshot, KeyBindings } from './types';

export const INPUT_ACTIONS: readonly InputAction[] = [
  'up',
  'down',
  'left',
  'right',
  'sneak',
  'dash',
  'interact',
  'decoy',
  'usePowerUp',
  'pause',
  'mute',
  'confirm',
  'cancel',
  'debug',
];

/** KeyboardEvent.code bindings. WASD + arrows, Shift sneak, Space dash. */
export const DEFAULT_BINDINGS: KeyBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sneak: ['ShiftLeft', 'ShiftRight'],
  dash: ['Space'],
  interact: ['KeyE'],
  decoy: ['KeyQ'],
  usePowerUp: ['KeyF'],
  pause: ['Escape'],
  mute: ['KeyM'],
  confirm: ['Enter'],
  cancel: ['Backspace'],
  debug: ['F1', 'Backquote'],
};

const ACTION_BIT: Record<InputAction, number> = {
  up: 1 << 0,
  down: 1 << 1,
  left: 1 << 2,
  right: 1 << 3,
  sneak: 1 << 4,
  dash: 1 << 5,
  interact: 1 << 6,
  decoy: 1 << 7,
  usePowerUp: 1 << 8,
  pause: 1 << 9,
  mute: 1 << 10,
  confirm: 1 << 11,
  cancel: 1 << 12,
  debug: 1 << 13,
};

export function actionBit(action: InputAction): number {
  return ACTION_BIT[action];
}

export function encodeInput(input: InputSnapshot): number {
  let bits = 0;
  for (let i = 0; i < INPUT_ACTIONS.length; i += 1) {
    const action = INPUT_ACTIONS[i] as InputAction;
    if (input.down(action)) bits |= ACTION_BIT[action];
  }
  return bits;
}

export function bitsDown(bits: number, action: InputAction): boolean {
  return (bits & ACTION_BIT[action]) !== 0;
}

export function mergeBindings(base: KeyBindings, extra?: Partial<KeyBindings>): KeyBindings {
  if (!extra) return { ...base, ...copyLists(base) };
  const out = copyLists(base);
  for (const action of INPUT_ACTIONS) {
    const list = extra[action];
    if (list && list.length > 0) out[action] = [...list];
  }
  return out;
}

function copyLists(src: KeyBindings): KeyBindings {
  const out = {} as KeyBindings;
  for (const action of INPUT_ACTIONS) out[action] = [...src[action]];
  return out;
}

export class FrozenInput implements InputSnapshot {
  readonly axisX: number;
  readonly axisY: number;
  private readonly held: number;
  private readonly was: number;

  constructor(held: number, was = 0) {
    this.held = held;
    this.was = was;
    const x = (held & ACTION_BIT.right ? 1 : 0) - (held & ACTION_BIT.left ? 1 : 0);
    const y = (held & ACTION_BIT.down ? 1 : 0) - (held & ACTION_BIT.up ? 1 : 0);
    this.axisX = x;
    this.axisY = y;
  }

  down(action: InputAction): boolean {
    return (this.held & ACTION_BIT[action]) !== 0;
  }

  pressed(action: InputAction): boolean {
    return this.down(action) && (this.was & ACTION_BIT[action]) === 0;
  }

  released(action: InputAction): boolean {
    return !this.down(action) && (this.was & ACTION_BIT[action]) !== 0;
  }
}

/**
 * Keyboard mapper. Call `beginFrame()` once per tick so `pressed` / `released`
 * edge-detect against the previous snapshot. `feedKey` is for tests and replay.
 */
export class InputManager implements InputSnapshot {
  private bindings: KeyBindings;
  private readonly codeToAction = new Map<string, InputAction[]>();
  private held = 0;
  private prev = 0;
  private target: EventTarget | null = null;
  private listening = false;

  constructor(bindings?: Partial<KeyBindings>) {
    this.bindings = mergeBindings(DEFAULT_BINDINGS, bindings);
    this.rebuildIndex();
  }

  get axisX(): number {
    return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
  }

  get axisY(): number {
    return (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
  }

  /** Unit-length stick, or zero when idle. */
  get axis(): { x: number; y: number } {
    const x = this.axisX;
    const y = this.axisY;
    const len = Math.hypot(x, y);
    if (len < 1e-6) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  }

  down(action: InputAction): boolean {
    return (this.held & ACTION_BIT[action]) !== 0;
  }

  pressed(action: InputAction): boolean {
    return this.down(action) && (this.prev & ACTION_BIT[action]) === 0;
  }

  released(action: InputAction): boolean {
    return !this.down(action) && (this.prev & ACTION_BIT[action]) !== 0;
  }

  beginFrame(): void {
    this.prev = this.held;
  }

  snapshot(): InputSnapshot {
    return new FrozenInput(this.held, this.prev);
  }

  bits(): number {
    return this.held;
  }

  feedBits(bits: number): void {
    this.held = bits >>> 0;
  }

  feedKey(code: string, isDown: boolean): void {
    const actions = this.codeToAction.get(code);
    if (!actions) return;
    for (let i = 0; i < actions.length; i += 1) {
      const bit = ACTION_BIT[actions[i] as InputAction];
      if (isDown) this.held |= bit;
      else this.held &= ~bit;
    }
  }

  rebind(action: InputAction, codes: readonly string[]): void {
    this.bindings[action] = [...codes];
    this.rebuildIndex();
  }

  bindingOf(action: InputAction): readonly string[] {
    return this.bindings[action];
  }

  getBindings(): KeyBindings {
    return copyLists(this.bindings);
  }

  resetBindings(): void {
    this.bindings = mergeBindings(DEFAULT_BINDINGS);
    this.rebuildIndex();
  }

  attach(target: EventTarget = defaultTarget()): void {
    if (this.listening) this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this.onBlur);
    }
    this.listening = true;
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this.onBlur);
    }
    this.target = null;
    this.listening = false;
  }

  clear(): void {
    this.held = 0;
    this.prev = 0;
  }

  private rebuildIndex(): void {
    this.codeToAction.clear();
    for (const action of INPUT_ACTIONS) {
      const codes = this.bindings[action];
      for (let i = 0; i < codes.length; i += 1) {
        const code = codes[i] as string;
        const list = this.codeToAction.get(code);
        if (list) list.push(action);
        else this.codeToAction.set(code, [action]);
      }
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      this.feedKey(event.code, true);
      return;
    }
    this.feedKey(event.code, true);
    if (this.codeToAction.has(event.code) && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.feedKey(event.code, false);
  };

  private readonly onBlur = (): void => {
    this.held = 0;
  };
}

function defaultTarget(): EventTarget {
  if (typeof window !== 'undefined') return window;
  throw new Error('InputManager.attach requires a window or explicit EventTarget');
}

export function makeInput(bindings?: Partial<KeyBindings>): InputManager {
  return new InputManager(bindings);
}
