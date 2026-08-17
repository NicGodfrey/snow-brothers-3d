import type { InputSnapshot } from '../engine/types';

export type MenuKind = 'action' | 'slider' | 'toggle';

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  kind?: MenuKind;
  value?: number;
  on?: boolean;
  action?: () => void;
  onChange?: (value: number | boolean) => void;
}

export interface MenuOptions {
  kicker?: string;
  title: string;
  blurb?: string;
  hint?: string;
  extra?: HTMLElement | null;
}

/** Keyboard-reachable list used by every overlay menu. */
export class Menu {
  items: MenuItem[];
  index: number;
  readonly options: MenuOptions;
  private readonly panel: HTMLElement;

  constructor(options: MenuOptions, items: MenuItem[], index = 0) {
    this.options = options;
    this.items = items;
    this.index = clampIndex(index, items);
    this.panel = document.createElement('div');
    this.panel.className = 'menu-panel';
    this.panel.setAttribute('role', 'menu');
    this.rebuild();
  }

  get selected(): MenuItem | undefined {
    return this.items[this.index];
  }

  setItems(items: MenuItem[], index = this.index): void {
    this.items = items;
    this.index = clampIndex(index, items);
    this.rebuild();
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    const count = this.items.length;
    let next = this.index;
    for (let i = 0; i < count; i += 1) {
      next = (next + delta + count) % count;
      if (!this.items[next]?.disabled) break;
    }
    this.index = next;
    this.rebuild();
  }

  activate(): void {
    const item = this.selected;
    if (!item || item.disabled) return;
    if (item.kind === 'toggle') {
      item.on = !item.on;
      item.onChange?.(item.on);
      this.rebuild();
      return;
    }
    item.action?.();
  }

  nudge(delta: number): void {
    const item = this.selected;
    if (!item || item.disabled) return;
    if (item.kind === 'slider') {
      const next = clamp01((item.value ?? 0) + delta * 0.08);
      item.value = next;
      item.onChange?.(next);
      this.rebuild();
      return;
    }
    if (item.kind === 'toggle' && delta !== 0) {
      item.on = delta > 0;
      item.onChange?.(item.on);
      this.rebuild();
    }
  }

  handleInput(input: InputSnapshot): boolean {
    if (input.pressed('up')) {
      this.move(-1);
      return true;
    }
    if (input.pressed('down')) {
      this.move(1);
      return true;
    }
    if (input.pressed('left')) {
      this.nudge(-1);
      return true;
    }
    if (input.pressed('right')) {
      this.nudge(1);
      return true;
    }
    if (input.pressed('confirm')) {
      this.activate();
      return true;
    }
    return false;
  }

  element(): HTMLElement {
    return this.panel;
  }

  rebuild(): void {
    const { kicker, title, blurb, hint, extra } = this.options;
    this.panel.replaceChildren();

    if (kicker) {
      const p = document.createElement('p');
      p.className = 'menu-kicker';
      p.textContent = kicker;
      this.panel.append(p);
    }

    const heading = document.createElement('h2');
    heading.className = 'menu-title';
    heading.textContent = title;
    this.panel.append(heading);

    if (blurb) {
      const p = document.createElement('p');
      p.className = 'menu-blurb';
      p.textContent = blurb;
      this.panel.append(p);
    }

    if (extra) this.panel.append(extra);

    const list = document.createElement('ul');
    list.className = 'menu-list';
    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i] as MenuItem;
      const li = document.createElement('li');
      li.className = 'menu-item';
      li.setAttribute('role', 'menuitem');
      if (i === this.index) li.classList.add('is-selected');
      if (item.disabled) li.classList.add('is-disabled');

      const label = document.createElement('span');
      label.textContent = item.label;
      li.append(label);

      const value = document.createElement('span');
      value.className = 'menu-item-value';
      value.textContent = valueText(item);
      if (value.textContent) li.append(value);

      list.append(li);
    }
    this.panel.append(list);

    const hintEl = document.createElement('p');
    hintEl.className = 'menu-hint';
    hintEl.textContent = hint ?? 'W/S or arrows move · Enter confirm · Esc back';
    this.panel.append(hintEl);
  }
}

export function menuBack(input: InputSnapshot): boolean {
  return input.pressed('cancel') || input.pressed('pause');
}

function valueText(item: MenuItem): string {
  if (item.kind === 'slider') return `${Math.round((item.value ?? 0) * 100)}%`;
  if (item.kind === 'toggle') return item.on ? 'On' : 'Off';
  return item.hint ?? '';
}

function clampIndex(index: number, items: MenuItem[]): number {
  if (items.length === 0) return 0;
  return Math.max(0, Math.min(items.length - 1, index));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
