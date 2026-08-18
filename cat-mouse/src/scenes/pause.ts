import type { Scene, SceneContext } from '../engine/types';
import type { App } from '../app';
import { Menu } from '../ui/menus';
import { screenCamera } from './boot';

export class PauseScene implements Scene {
  readonly name = 'pause';
  private readonly app: App;
  private menu: Menu | null = null;
  private readyAt = 0;

  constructor(app: App) {
    this.app = app;
  }

  enter(ctx: SceneContext): void {
    this.readyAt = ctx.clock.elapsed + 0.22;
    this.app.overlay.showHud();
    this.menu = new Menu(
      {
        kicker: 'Paused',
        title: 'Hold still',
        blurb: 'The cat can still hear you thinking.',
      },
      [
        { id: 'resume', label: 'Resume', action: () => this.app.resumePlay() },
        { id: 'settings', label: 'Settings', action: () => this.app.goSettings() },
        { id: 'restart', label: 'Restart stage', action: () => this.app.restartStage() },
        { id: 'map', label: 'Chapter map', action: () => this.app.goChapterMap() },
        { id: 'title', label: 'Title', action: () => this.app.goTitle() },
      ],
    );
    this.app.overlay.setMenu(this.menu.element());
  }

  resume(ctx: SceneContext): void {
    this.enter(ctx);
  }

  exit(): void {
    this.app.overlay.clearMenu();
  }

  update(ctx: SceneContext): void {
    if (ctx.clock.elapsed < this.readyAt || !this.menu) return;
    if (ctx.input.pressed('cancel') || ctx.input.pressed('pause')) {
      this.app.resumePlay();
      return;
    }
    this.menu.handleInput(ctx.input);
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.rect(0, 0, width, height, '#140c0880');
    renderer.end();
  }
}
