import type { Camera, Color, LightDraw, Rect, RendererLike, SpriteDraw } from './types';

export interface RendererOptions {
  ambient?: number;
  fogColor?: string;
  clearColor?: string;
  font?: string;
}

type DrawCmd =
  | { kind: 'sprite'; draw: SpriteDraw }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; layer: number }
  | { kind: 'circle'; x: number; y: number; r: number; color: string; layer: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; layer: number }
  | { kind: 'text'; text: string; x: number; y: number; color: string; size: number; align: CanvasTextAlign; layer: number };

export interface DrawStats {
  sprites: number;
  lights: number;
  commands: number;
}

export interface FogCell {
  visible: number;
  explored: number;
}

/**
 * Discrete fog / visibility grid. `visible` fades; `explored` stays once seen.
 */
export class FogMap {
  readonly width: number;
  readonly height: number;
  private readonly visible: Float32Array;
  private readonly explored: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.visible = new Float32Array(n);
    this.explored = new Float32Array(n);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isVisible(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return (this.visible[y * this.width + x] as number) > 0.05;
  }

  isExplored(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return (this.explored[y * this.width + x] as number) > 0.05;
  }

  visibility(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.visible[y * this.width + x] as number;
  }

  reveal(cx: number, cy: number, radius: number, amount = 1): void {
    const r = Math.ceil(radius);
    const rSq = radius * radius;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > rSq) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        const i = y * this.width + x;
        const falloff = 1 - Math.sqrt(dx * dx + dy * dy) / (radius + 1e-6);
        const next = Math.min(1, (this.visible[i] as number) + amount * falloff);
        this.visible[i] = next;
        if (next > (this.explored[i] as number)) this.explored[i] = next;
      }
    }
  }

  /** Fade current visibility; explored memory is kept. */
  decay(dt: number, rate = 2.4): void {
    const keep = Math.exp(-rate * dt);
    for (let i = 0; i < this.visible.length; i += 1) {
      this.visible[i] = (this.visible[i] as number) * keep;
    }
  }

  clearVisibility(): void {
    this.visible.fill(0);
  }

  reset(): void {
    this.visible.fill(0);
    this.explored.fill(0);
  }

  cell(x: number, y: number): FogCell {
    if (!this.inBounds(x, y)) return { visible: 0, explored: 0 };
    const i = y * this.width + x;
    return { visible: this.visible[i] as number, explored: this.explored[i] as number };
  }
}

export class CanvasRenderer implements RendererLike {
  readonly canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null;
  private lightCanvas: HTMLCanvasElement | null = null;
  private lightCtx: CanvasRenderingContext2D | null = null;
  private camera: Camera | null = null;
  private cmds: DrawCmd[] = [];
  private lights: LightDraw[] = [];
  private fog: FogMap | null = null;
  private tileSize = 16;
  ambient: number;
  fogColor: string;
  clearColor: string;
  fontFamily: string;
  readonly stats: DrawStats = { sprites: 0, lights: 0, commands: 0 };

  constructor(canvas?: HTMLCanvasElement | null, options: RendererOptions = {}) {
    this.canvas = canvas ?? null;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.ambient = options.ambient ?? 0.22;
    this.fogColor = options.fogColor ?? 'rgba(4, 6, 12, 1)';
    this.clearColor = options.clearColor ?? '#0b1020';
    this.fontFamily = options.font ?? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    if (this.canvas && typeof document !== 'undefined') {
      this.lightCanvas = document.createElement('canvas');
      this.lightCanvas.width = this.canvas.width;
      this.lightCanvas.height = this.canvas.height;
      this.lightCtx = this.lightCanvas.getContext('2d');
    }
  }

  setFog(fog: FogMap | null, tileSize = 16): void {
    this.fog = fog;
    this.tileSize = tileSize;
  }

  setAmbient(value: number): void {
    this.ambient = value;
  }

  resize(width: number, height: number): void {
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.lightCanvas) {
      this.lightCanvas.width = width;
      this.lightCanvas.height = height;
    }
  }

  begin(camera: Camera): void {
    this.camera = camera;
    this.cmds = [];
    this.lights = [];
    this.stats.sprites = 0;
    this.stats.lights = 0;
    this.stats.commands = 0;
    this.syncLightSurface();
  }

  clear(color: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  sprite(draw: SpriteDraw): void {
    this.cmds.push({ kind: 'sprite', draw });
    this.stats.sprites += 1;
  }

  rect(x: number, y: number, w: number, h: number, color: string, layer = 0): void {
    this.cmds.push({ kind: 'rect', x, y, w, h, color, layer });
  }

  circle(x: number, y: number, r: number, color: string, layer = 0): void {
    this.cmds.push({ kind: 'circle', x, y, r, color, layer });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 1, layer = 0): void {
    this.cmds.push({ kind: 'line', x1, y1, x2, y2, color, width, layer });
  }

  text(
    text: string,
    x: number,
    y: number,
    color: string,
    size = 14,
    align: CanvasTextAlign = 'left',
    layer = 100,
  ): void {
    this.cmds.push({ kind: 'text', text, x, y, color, size, align, layer });
  }

  light(light: LightDraw): void {
    this.lights.push(light);
    this.stats.lights += 1;
  }

  end(): void {
    const ctx = this.ctx;
    const camera = this.camera;
    if (!ctx || !this.canvas || !camera) {
      this.stats.commands = this.cmds.length;
      return;
    }
    this.cmds.sort((a, b) => layerOf(a) - layerOf(b));
    this.stats.commands = this.cmds.length;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    for (let i = 0; i < this.cmds.length; i += 1) {
      this.paint(ctx, camera, this.cmds[i]!);
    }

    this.paintLights(ctx, camera);
    this.paintFog(ctx, camera);
  }

  commands(): readonly DrawCmd[] {
    return this.cmds;
  }

  lightsQueued(): readonly LightDraw[] {
    return this.lights;
  }

  private paint(ctx: CanvasRenderingContext2D, camera: Camera, cmd: DrawCmd): void {
    switch (cmd.kind) {
      case 'sprite': {
        const d = cmd.draw;
        const p = worldToScreen(camera, d.x, d.y);
        ctx.save();
        ctx.globalAlpha = d.alpha ?? 1;
        ctx.translate(p.x, p.y);
        if (d.rotation) ctx.rotate(d.rotation);
        ctx.fillStyle = d.color;
        ctx.fillRect((-d.w / 2) * camera.zoom, (-d.h / 2) * camera.zoom, d.w * camera.zoom, d.h * camera.zoom);
        ctx.restore();
        break;
      }
      case 'rect': {
        const p = worldToScreen(camera, cmd.x, cmd.y);
        ctx.globalAlpha = 1;
        ctx.fillStyle = cmd.color;
        ctx.fillRect(p.x, p.y, cmd.w * camera.zoom, cmd.h * camera.zoom);
        break;
      }
      case 'circle': {
        const p = worldToScreen(camera, cmd.x, cmd.y);
        ctx.beginPath();
        ctx.globalAlpha = 1;
        ctx.fillStyle = cmd.color;
        ctx.arc(p.x, p.y, cmd.r * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'line': {
        const a = worldToScreen(camera, cmd.x1, cmd.y1);
        const b = worldToScreen(camera, cmd.x2, cmd.y2);
        ctx.beginPath();
        ctx.strokeStyle = cmd.color;
        ctx.lineWidth = cmd.width;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case 'text': {
        ctx.font = `${cmd.size}px ${this.fontFamily}`;
        ctx.fillStyle = cmd.color;
        ctx.textAlign = cmd.align;
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 1;
        ctx.fillText(cmd.text, cmd.x, cmd.y);
        break;
      }
    }
  }

  private paintLights(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const lightCtx = this.lightCtx;
    const lightCanvas = this.lightCanvas;
    if (!lightCtx || !lightCanvas || this.lights.length === 0 && this.ambient >= 1) return;
    lightCtx.setTransform(1, 0, 0, 1, 0, 0);
    lightCtx.globalCompositeOperation = 'source-over';
    const darkness = 1 - this.ambient;
    lightCtx.fillStyle = `rgba(0, 0, 0, ${darkness})`;
    lightCtx.fillRect(0, 0, lightCanvas.width, lightCanvas.height);
    lightCtx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i]!;
      const p = worldToScreen(camera, light.x, light.y);
      const radius = light.radius * camera.zoom;
      lightCtx.save();
      if (light.cone !== undefined) {
        const angle = light.angle ?? 0;
        lightCtx.beginPath();
        lightCtx.moveTo(p.x, p.y);
        lightCtx.arc(p.x, p.y, radius, angle - light.cone, angle + light.cone);
        lightCtx.closePath();
        lightCtx.clip();
      }
      const gradient = lightCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      const alpha = Math.max(0, Math.min(1, light.intensity));
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      lightCtx.fillStyle = gradient;
      lightCtx.beginPath();
      lightCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      lightCtx.fill();
      lightCtx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
    ctx.restore();
  }

  private paintFog(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const fog = this.fog;
    if (!fog) return;
    const color = parseCssColor(this.fogColor);
    const view = viewRectOf(camera);
    const minX = Math.max(0, Math.floor(view.x / this.tileSize) - 1);
    const minY = Math.max(0, Math.floor(view.y / this.tileSize) - 1);
    const maxX = Math.min(fog.width - 1, Math.floor((view.x + view.w) / this.tileSize) + 1);
    const maxY = Math.min(fog.height - 1, Math.floor((view.y + view.h) / this.tileSize) + 1);
    for (let ty = minY; ty <= maxY; ty += 1) {
      for (let tx = minX; tx <= maxX; tx += 1) {
        const cell = fog.cell(tx, ty);
        let alpha = 0;
        if (cell.explored <= 0.01) alpha = 0.92;
        else if (cell.visible <= 0.05) alpha = 0.55 * (1 - cell.explored * 0.3);
        else alpha = 0.18 * (1 - cell.visible);
        if (alpha <= 0.01) continue;
        const p = worldToScreen(camera, tx * this.tileSize, ty * this.tileSize);
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha * color.a})`;
        ctx.fillRect(p.x, p.y, this.tileSize * camera.zoom, this.tileSize * camera.zoom);
      }
    }
  }

  private syncLightSurface(): void {
    if (!this.canvas || !this.lightCanvas) return;
    if (this.lightCanvas.width !== this.canvas.width || this.lightCanvas.height !== this.canvas.height) {
      this.lightCanvas.width = this.canvas.width;
      this.lightCanvas.height = this.canvas.height;
    }
  }
}

function layerOf(cmd: DrawCmd): number {
  if (cmd.kind === 'sprite') return cmd.draw.layer ?? 0;
  return cmd.layer;
}

function worldToScreen(camera: Camera, x: number, y: number): { x: number; y: number } {
  const shake = camera.shake * camera.shake;
  return {
    x: (x - camera.x) * camera.zoom + camera.viewportWidth / 2 + shake,
    y: (y - camera.y) * camera.zoom + camera.viewportHeight / 2 + shake,
  };
}

function viewRectOf(camera: Camera): Rect {
  const w = camera.viewportWidth / camera.zoom;
  const h = camera.viewportHeight / camera.zoom;
  return { x: camera.x - w / 2, y: camera.y - h / 2, w, h };
}

export function parseCssColor(color: string): Color {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0], 16),
        g: parseInt(hex[1]! + hex[1], 16),
        b: parseInt(hex[2]! + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const rgba = color.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const parts = rgba[1]!.split(',').map((p) => Number(p.trim()));
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/** Records draw calls for headless tests. */
export class HeadlessRenderer implements RendererLike {
  camera: Camera | null = null;
  sprites: SpriteDraw[] = [];
  lights: LightDraw[] = [];
  texts: { text: string; x: number; y: number; color: string }[] = [];
  cleared: string | null = null;

  begin(camera: Camera): void {
    this.camera = camera;
    this.sprites = [];
    this.lights = [];
    this.texts = [];
    this.cleared = null;
  }

  clear(color: string): void {
    this.cleared = color;
  }

  sprite(draw: SpriteDraw): void {
    this.sprites.push(draw);
  }

  rect(_x: number, _y: number, _w: number, _h: number, _color: string): void {}

  circle(_x: number, _y: number, _r: number, _color: string): void {}

  line(_x1: number, _y1: number, _x2: number, _y2: number, _color: string, _width?: number): void {}

  text(text: string, x: number, y: number, color: string): void {
    this.texts.push({ text, x, y, color });
  }

  light(light: LightDraw): void {
    this.lights.push(light);
  }

  end(): void {}
}
