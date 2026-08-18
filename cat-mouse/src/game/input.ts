import type { InputAction, InputSnapshot } from '../engine/types';

const ACTIONS: readonly InputAction[] = [
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

/** Headless input buffer used by the simulation and tests. */
export class FrameInput implements InputSnapshot {
  axisX = 0;
  axisY = 0;
  private readonly held = new Set<InputAction>();
  private readonly justDown = new Set<InputAction>();
  private readonly justUp = new Set<InputAction>();

  setAxis(x: number, y: number): this {
    const len = Math.hypot(x, y);
    if (len > 1) {
      this.axisX = x / len;
      this.axisY = y / len;
    } else {
      this.axisX = x;
      this.axisY = y;
    }
    return this;
  }

  hold(action: InputAction): this {
    if (!this.held.has(action)) this.justDown.add(action);
    this.held.add(action);
    return this;
  }

  release(action: InputAction): this {
    if (this.held.delete(action)) this.justUp.add(action);
    return this;
  }

  press(action: InputAction): this {
    this.held.add(action);
    this.justDown.add(action);
    return this;
  }

  clear(): this {
    this.held.clear();
    this.justDown.clear();
    this.justUp.clear();
    this.axisX = 0;
    this.axisY = 0;
    return this;
  }

  /** Call after a simulation step so `pressed` is one-frame. */
  endFrame(): this {
    this.justDown.clear();
    this.justUp.clear();
    return this;
  }

  down(action: InputAction): boolean {
    return this.held.has(action);
  }

  pressed(action: InputAction): boolean {
    return this.justDown.has(action);
  }

  released(action: InputAction): boolean {
    return this.justUp.has(action);
  }

  snapshot(): InputSnapshot {
    const axisX = this.axisX;
    const axisY = this.axisY;
    const held = new Set(this.held);
    const justDown = new Set(this.justDown);
    const justUp = new Set(this.justUp);
    return {
      axisX,
      axisY,
      down: (action) => held.has(action),
      pressed: (action) => justDown.has(action),
      released: (action) => justUp.has(action),
    };
  }
}

export function emptyInput(): InputSnapshot {
  return {
    axisX: 0,
    axisY: 0,
    down: () => false,
    pressed: () => false,
    released: () => false,
  };
}

export function inputFromAxis(x: number, y: number, extras: Partial<Record<InputAction, 'down' | 'pressed'>> = {}): FrameInput {
  const input = new FrameInput().setAxis(x, y);
  for (const action of ACTIONS) {
    const mode = extras[action];
    if (mode === 'down') input.hold(action);
    if (mode === 'pressed') input.press(action);
  }
  return input;
}
