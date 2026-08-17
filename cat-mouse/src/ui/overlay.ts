/** DOM overlay that sits on `#overlay` above the canvas. */

export class Overlay {
  readonly root: HTMLElement;
  readonly hudRoot: HTMLElement;
  readonly bannerRoot: HTMLElement;
  readonly menuRoot: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.replaceChildren();

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'hud';
    this.hudRoot.hidden = true;

    this.bannerRoot = document.createElement('div');
    this.bannerRoot.className = 'overlay-banner';
    this.bannerRoot.setAttribute('role', 'status');

    this.menuRoot = document.createElement('div');
    this.menuRoot.className = 'menu-root';

    this.root.append(this.hudRoot, this.bannerRoot, this.menuRoot);
  }

  setBanner(text: string | null): void {
    this.bannerRoot.textContent = text ?? '';
  }

  setMenu(node: HTMLElement | null): void {
    this.menuRoot.replaceChildren();
    if (node) this.menuRoot.append(node);
  }

  clearMenu(): void {
    this.menuRoot.replaceChildren();
  }

  showHud(): void {
    this.hudRoot.hidden = false;
  }

  hideHud(): void {
    this.hudRoot.hidden = true;
  }

  clear(): void {
    this.setBanner(null);
    this.clearMenu();
    this.hideHud();
  }
}
