import type { Scene, SceneContext } from '../engine/types';
import type { GameMode } from '../game/types';
import type { App } from '../app';
import { Menu, menuBack } from '../ui/menus';
import { screenCamera } from './boot';

const MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'story', label: 'Story', hint: '12 chapters · 8 stages' },
  { id: 'arcade', label: 'Arcade', hint: 'Endless hunt' },
  { id: 'timeAttack', label: 'Time Attack', hint: 'One kitchen, one clock' },
  { id: 'mirror', label: 'Mirror', hint: 'Play as the cat' },
  { id: 'hotseat', label: 'Hotseat', hint: 'Two players, one keyboard' },
  { id: 'sandbox', label: 'Sandbox', hint: 'Free roam' },
];

export class ModeSelectScene implements Scene {
  readonly name = 'modeSelect';
  private readonly app: App;
  private menu: Menu | null = null;
  private readyAt = 0;

  constructor(app: App) {
    this.app = app;
  }

  enter(ctx: SceneContext): void {
    this.readyAt = ctx.clock.elapsed + 0.16;
    this.app.mode = 'story';
    this.menu = new Menu(
      {
        kicker: 'Select protocol',
        title: 'Game Mode',
        blurb: 'Story opens chapter 1. Other modes still drop you in a kitchen.',
      },
      MODES.map((mode) => ({
        id: mode.id,
        label: mode.label,
        hint: mode.hint,
        action: () => this.choose(mode.id),
      })),
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
    if (menuBack(ctx.input)) {
      this.app.goTitle();
      return;
    }
    this.menu.handleInput(ctx.input);
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.clear('#14100d');
    renderer.rect(40, 40, width - 80, height - 80, '#1c1612');
    renderer.end();
  }

  private choose(mode: GameMode): void {
    this.app.mode = mode;
    this.app.chapter = 1;
    this.app.stageIndex = 1;
    if (mode === 'story') this.app.goChapterMap();
    else void this.app.goPlay(1, 1);
  }
}
