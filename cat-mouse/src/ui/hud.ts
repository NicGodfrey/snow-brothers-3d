import type { CatState } from '../game/types';

export interface HudModel {
  lives: number;
  livesMax: number;
  cheeseBanked: number;
  quota: number;
  cheeseCarried: number;
  stamina: number;
  staminaMax: number;
  heat: number;
  catState: CatState | string;
  stageName?: string;
}

const EMPTY: HudModel = {
  lives: 3,
  livesMax: 3,
  cheeseBanked: 0,
  quota: 3,
  cheeseCarried: 0,
  stamina: 1,
  staminaMax: 1,
  heat: 0,
  catState: 'patrol',
};

/** Overlay HUD: lives, cheese quota, stamina, heat, cat state. */
export class Hud {
  private readonly host: HTMLElement;
  private readonly livesEl: HTMLElement;
  private readonly cheeseEl: HTMLElement;
  private readonly staminaEl: HTMLElement;
  private readonly heatEl: HTMLElement;
  private readonly catEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private model: HudModel = EMPTY;

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.replaceChildren();

    const lives = group('Lives');
    this.livesEl = document.createElement('div');
    this.livesEl.className = 'hud-lives';
    lives.append(this.livesEl);

    const cheese = group('Cheese');
    this.cheeseEl = document.createElement('div');
    this.cheeseEl.className = 'hud-cheese';
    cheese.append(this.cheeseEl);

    const stamina = group('Stamina');
    this.staminaEl = meter();
    stamina.append(this.staminaEl);

    const heat = group('Heat');
    this.heatEl = meter();
    this.heatEl.classList.add('is-heat');
    heat.append(this.heatEl);

    const cat = group('Cat');
    this.catEl = document.createElement('div');
    this.catEl.className = 'hud-cat';
    cat.append(this.catEl);

    const stage = group('Stage');
    this.stageEl = document.createElement('div');
    this.stageEl.className = 'hud-stage';
    stage.append(this.stageEl);

    this.host.append(lives, cheese, stamina, heat, cat, stage);
    this.update(EMPTY);
  }

  update(model: Partial<HudModel>): void {
    this.model = { ...this.model, ...model };
    const m = this.model;

    this.livesEl.replaceChildren();
    const max = Math.max(1, m.livesMax);
    for (let i = 0; i < max; i += 1) {
      const pip = document.createElement('span');
      pip.className = 'hud-life';
      if (i >= m.lives) pip.classList.add('is-lost');
      this.livesEl.append(pip);
    }

    const carried = m.cheeseCarried > 0 ? ` +${m.cheeseCarried}` : '';
    this.cheeseEl.innerHTML = `<strong>${m.cheeseBanked}</strong> / ${m.quota}${carried}`;

    const stamina = m.staminaMax > 0 ? m.stamina / m.staminaMax : 0;
    fill(this.staminaEl, stamina);
    fill(this.heatEl, m.heat);

    const state = String(m.catState);
    this.catEl.dataset.state = state;
    this.catEl.textContent = state;
    this.stageEl.textContent = m.stageName ?? 'Kitchen';
  }
}

function group(label: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'hud-group';
  const tag = document.createElement('div');
  tag.className = 'hud-label';
  tag.textContent = label;
  wrap.append(tag);
  return wrap;
}

function meter(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'hud-meter';
  const i = document.createElement('i');
  el.append(i);
  return el;
}

function fill(meterEl: HTMLElement, amount: number): void {
  const bar = meterEl.firstElementChild as HTMLElement | null;
  if (!bar) return;
  const pct = Math.max(0, Math.min(1, amount)) * 100;
  bar.style.width = `${pct}%`;
}
