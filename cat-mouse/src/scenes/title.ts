import type { Scene, SceneContext } from '../engine/types';
import type { App } from '../app';
import { Menu } from '../ui/menus';
import { screenCamera } from './boot';

export class TitleScene implements Scene {
  readonly name = 'title';
  private readonly app: App;
  private menu: Menu | null = null;
  private readyAt = 0;
  private pulse = 0;

  constructor(app: App) {
    this.app = app;
  }

  enter(ctx: SceneContext): void {
    this.app.prepareStoryPath();
    this.readyAt = ctx.clock.elapsed + 0.16;
    this.menu = new Menu(
      {
        kicker: 'Cat & Mouse',
        title: 'Chase Protocol',
        blurb: 'Steal the cheese. Do not get caught. Deposit it in the hole.',
        hint: 'Enter starts Story · arrows move',
      },
      [
        { id: 'story', label: 'Story', action: () => this.app.goModeSelect() },
        { id: 'settings', label: 'Settings', action: () => this.app.goSettings() },
      ],
    );
    this.app.overlay.hideHud();
    this.app.overlay.setMenu(this.menu.element());
    ctx.audio.play({
      id: 'title-drone',
      bus: 'ambience',
      frequency: 62,
      duration: 1.4,
      type: 'sine',
      gain: 0.035,
    });
  }

  resume(ctx: SceneContext): void {
    this.enter(ctx);
  }

  exit(): void {
    this.app.overlay.clearMenu();
  }

  update(ctx: SceneContext, step: number): void {
    this.pulse += step;
    if (ctx.clock.elapsed < this.readyAt || !this.menu) return;
    this.menu.handleInput(ctx.input);
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.clear('#16100c');
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const even = (x + y) % 2 === 0;
        renderer.rect(x * 80, y * 72, 80, 72, even ? '#2a211a' : '#241c16');
      }
    }
    renderer.rect(0, 0, width, 48, '#1a120e');
    renderer.rect(0, height - 64, width, 64, '#1a120e');
    renderer.rect(width * 0.35, height * 0.42, 220, 36, '#5a3a22');
    renderer.circle(width * 0.28, height * 0.58, 14, '#d8d2c4');
    renderer.rect(width * 0.7, height * 0.5, 34, 26, '#e08a3c');
    renderer.light({
      x: width * 0.5,
      y: height * 0.2,
      radius: 280,
      color: '#ffb25a',
      intensity: 0.35 + Math.sin(this.pulse * 2) * 0.05,
    });
    renderer.text('Squeak vs Pounce', width / 2, height * 0.16, '#c4a15a', 18, 'center');
    renderer.end();
  }
}
