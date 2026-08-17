import type { Scene, SceneContext } from '../engine/types';
import type { App } from '../app';

/** Brief kitchen-dark load-in before the title. */
export class BootScene implements Scene {
  readonly name = 'boot';
  private elapsed = 0;
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  enter(ctx: SceneContext): void {
    this.app.overlay.clear();
    this.app.overlay.setBanner('Warming the stove…');
    ctx.audio.play({
      id: 'boot',
      bus: 'ui',
      frequency: 110,
      duration: 0.18,
      type: 'sine',
      gain: 0.05,
    });
  }

  exit(): void {
    this.app.overlay.setBanner(null);
  }

  update(ctx: SceneContext, step: number): void {
    this.elapsed += step;
    if (this.elapsed > 0.7 || ctx.input.pressed('confirm') || ctx.input.pressed('cancel')) {
      this.app.goTitle();
    }
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.clear('#120e0b');
    renderer.rect(width * 0.18, height * 0.62, width * 0.64, 18, '#2a1c14');
    renderer.rect(width * 0.18, height * 0.62, Math.min(1, this.elapsed / 0.7) * width * 0.64, 18, '#c4a15a');
    renderer.circle(width * 0.5, height * 0.38, 36, '#d8d2c4');
    renderer.rect(width * 0.72, height * 0.3, 48, 36, '#e08a3c');
    renderer.text('CHASE PROTOCOL', width / 2, height * 0.22, '#efe6d4', 42, 'center');
    renderer.end();
  }
}

export function screenCamera(width: number, height: number) {
  return {
    x: width / 2,
    y: height / 2,
    zoom: 1,
    shake: 0,
    viewportWidth: width,
    viewportHeight: height,
  };
}
