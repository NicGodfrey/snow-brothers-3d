import type { Scene, SceneContext } from './types';

/**
 * LIFO scene stack. The top scene receives update/render; the previous scene
 * is paused (not updated) until the top pops.
 */
export class SceneStack {
  private readonly stack: Scene[] = [];

  get size(): number {
    return this.stack.length;
  }

  current(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  names(): string[] {
    return this.stack.map((s) => s.name);
  }

  push(scene: Scene, ctx: SceneContext): void {
    const top = this.current();
    if (top?.pause) top.pause(ctx);
    this.stack.push(scene);
    scene.enter?.(ctx);
  }

  pop(ctx: SceneContext): Scene | undefined {
    const top = this.stack.pop();
    if (top?.exit) top.exit(ctx);
    const next = this.current();
    next?.resume?.(ctx);
    return top;
  }

  replace(scene: Scene, ctx: SceneContext): void {
    const top = this.stack.pop();
    if (top?.exit) top.exit(ctx);
    this.stack.push(scene);
    scene.enter?.(ctx);
  }

  clear(ctx: SceneContext): void {
    while (this.stack.length > 0) {
      const top = this.stack.pop()!;
      top.exit?.(ctx);
    }
  }

  update(ctx: SceneContext, step: number): void {
    this.current()?.update(ctx, step);
  }

  render(ctx: SceneContext, alpha: number): void {
    this.current()?.render(ctx, alpha);
  }
}

export function makeScene(
  name: string,
  handlers: Pick<Scene, 'enter' | 'exit' | 'pause' | 'resume' | 'update' | 'render'>,
): Scene {
  return { name, ...handlers };
}
