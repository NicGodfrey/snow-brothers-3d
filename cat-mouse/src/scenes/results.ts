import type { Scene, SceneContext } from '../engine/types';
import type { StageResult } from '../game/types';
import type { App } from '../app';
import { Menu } from '../ui/menus';
import { screenCamera } from './boot';

export class ResultsScene implements Scene {
  readonly name = 'results';
  private readonly app: App;
  private readonly result: StageResult;
  private menu: Menu | null = null;
  private readyAt = 0;

  constructor(app: App, result: StageResult) {
    this.app = app;
    this.result = result;
  }

  enter(ctx: SceneContext): void {
    this.readyAt = ctx.clock.elapsed + 0.2;
    const won = this.result.outcome === 'won';
    this.menu = new Menu(
      {
        kicker: won ? 'Plate cleared' : 'Caught',
        title: won ? 'You got away' : 'Pounce landed',
        blurb: `${this.result.cheeseBanked}/${this.result.quota} cheese · ${this.result.stars} star${this.result.stars === 1 ? '' : 's'} · ${this.result.score} pts`,
      },
      [
        { id: 'retry', label: 'Retry', action: () => this.app.restartStage() },
        ...(won
          ? [{ id: 'next', label: 'Next stage', action: () => this.app.nextStage() }]
          : []),
        { id: 'map', label: 'Chapter map', action: () => this.app.goChapterMap() },
        { id: 'title', label: 'Title', action: () => this.app.goTitle() },
      ],
    );
    this.app.overlay.setMenu(this.menu.element());
    ctx.audio.play({
      id: won ? 'win' : 'lose',
      bus: 'ui',
      frequency: won ? 440 : 90,
      duration: 0.22,
      type: won ? 'triangle' : 'sawtooth',
      gain: 0.07,
    });
  }

  resume(ctx: SceneContext): void {
    this.enter(ctx);
  }

  exit(): void {
    this.app.overlay.clearMenu();
  }

  update(ctx: SceneContext): void {
    if (ctx.clock.elapsed < this.readyAt || !this.menu) return;
    this.menu.handleInput(ctx.input);
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.clear(this.result.outcome === 'won' ? '#16140e' : '#1a0e0c');
    renderer.text(
      this.result.noCatch ? 'Clean run' : `${this.result.catches} catch${this.result.catches === 1 ? '' : 'es'}`,
      width / 2,
      64,
      '#c4a15a',
      18,
      'center',
    );
    renderer.end();
  }
}
