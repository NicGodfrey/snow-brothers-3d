import type { Scene, SceneContext } from '../engine/types';
import type { App } from '../app';
import { Menu, menuBack } from '../ui/menus';
import { screenCamera } from './boot';

export class SettingsScene implements Scene {
  readonly name = 'settings';
  private readonly app: App;
  private menu: Menu | null = null;
  private readyAt = 0;

  constructor(app: App) {
    this.app = app;
  }

  enter(ctx: SceneContext): void {
    this.readyAt = ctx.clock.elapsed + 0.16;
    const s = this.app.settings;
    this.menu = new Menu(
      {
        kicker: 'Options',
        title: 'Settings',
        blurb: 'Volumes and readability. Bindings stay on the defaults until the engine rebind lands.',
      },
      [
        {
          id: 'master',
          label: 'Master',
          kind: 'slider',
          value: s.masterVolume,
          onChange: (value) => {
            if (typeof value === 'number') s.masterVolume = value;
            this.app.applySettings();
          },
        },
        {
          id: 'sfx',
          label: 'SFX',
          kind: 'slider',
          value: s.sfxVolume,
          onChange: (value) => {
            if (typeof value === 'number') s.sfxVolume = value;
            this.app.applySettings();
          },
        },
        {
          id: 'music',
          label: 'Music',
          kind: 'slider',
          value: s.musicVolume,
          onChange: (value) => {
            if (typeof value === 'number') s.musicVolume = value;
            this.app.applySettings();
          },
        },
        {
          id: 'shake',
          label: 'Screen shake',
          kind: 'toggle',
          on: s.screenShake,
          onChange: (value) => {
            if (typeof value === 'boolean') s.screenShake = value;
            this.app.applySettings();
          },
        },
        {
          id: 'contrast',
          label: 'High contrast',
          kind: 'toggle',
          on: s.highContrast,
          onChange: (value) => {
            if (typeof value === 'boolean') s.highContrast = value;
            this.app.applySettings();
          },
        },
        {
          id: 'debug',
          label: 'Debug overlay',
          kind: 'toggle',
          on: s.showDebug,
          onChange: (value) => {
            if (typeof value === 'boolean') s.showDebug = value;
            this.app.applySettings();
          },
        },
        { id: 'back', label: 'Back', action: () => this.app.pop() },
      ],
    );
    this.app.overlay.setMenu(this.menu.element());
  }

  exit(): void {
    this.app.overlay.clearMenu();
  }

  update(ctx: SceneContext): void {
    if (ctx.clock.elapsed < this.readyAt || !this.menu) return;
    if (menuBack(ctx.input)) {
      this.app.pop();
      return;
    }
    this.menu.handleInput(ctx.input);
  }

  render(ctx: SceneContext): void {
    const { renderer, width, height } = ctx;
    renderer.begin(screenCamera(width, height));
    renderer.rect(0, 0, width, height, 'rgba(10,8,6,0.35)');
    renderer.end();
  }
}
