import { FrameTimer } from './loop';
import type { Camera, RendererLike } from './types';

export interface DebugWatch {
  key: string;
  value: string;
}

/**
 * Overlay counters, watches and a frame-time sparkline. Toggle with the
 * `debug` input action; gameplay never depends on this being enabled.
 */
export class DebugOverlay {
  enabled = false;
  readonly graph = new FrameTimer(120);
  private readonly watches = new Map<string, string>();
  private readonly logs: string[] = [];
  private readonly logLimit: number;
  frames = 0;
  updates = 0;

  constructor(logLimit = 24) {
    this.logLimit = logLimit;
  }

  toggle(): void {
    this.enabled = !this.enabled;
  }

  watch(key: string, value: unknown): void {
    this.watches.set(key, formatValue(value));
  }

  unwatch(key: string): void {
    this.watches.delete(key);
  }

  log(message: string): void {
    this.logs.push(message);
    if (this.logs.length > this.logLimit) this.logs.shift();
  }

  sampleFrame(seconds: number): void {
    this.graph.push(seconds);
    this.frames += 1;
  }

  markUpdate(): void {
    this.updates += 1;
  }

  lines(): string[] {
    const avg = this.graph.average;
    const fps = avg > 0 ? (1 / avg).toFixed(1) : '0.0';
    const worst = (this.graph.worst * 1000).toFixed(2);
    const out = [
      `fps ${fps}  worst ${worst}ms  frames ${this.frames}`,
      `updates ${this.updates}`,
    ];
    const keys = [...this.watches.keys()].sort();
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i] as string;
      out.push(`${key}: ${this.watches.get(key)}`);
    }
    for (let i = 0; i < this.logs.length; i += 1) out.push(this.logs[i] as string);
    return out;
  }

  dump(): string {
    return this.lines().join('\n');
  }

  draw(renderer: RendererLike, _camera?: Camera): void {
    if (!this.enabled) return;
    const rows = this.lines();
    renderer.rect(8, 8, 360, 16 + rows.length * 14, 'rgba(0,0,0,0.55)');
    for (let i = 0; i < rows.length; i += 1) {
      renderer.text(rows[i] as string, 14, 12 + i * 14, '#d7ffe4', 12, 'left');
    }
    this.drawGraph(renderer, 8, 16 + rows.length * 14 + 8, 360, 48);
  }

  private drawGraph(renderer: RendererLike, x: number, y: number, w: number, h: number): void {
    const history = this.graph.history();
    renderer.rect(x, y, w, h, 'rgba(0,0,0,0.4)');
    if (history.length < 2) return;
    const worst = Math.max(this.graph.worst, 1 / 120);
    const step = w / Math.max(1, history.length - 1);
    let prevX = x;
    let prevY = y + h;
    for (let i = 0; i < history.length; i += 1) {
      const t = (history[i] as number) / worst;
      const nx = x + i * step;
      const ny = y + h - Math.min(1, t) * h;
      renderer.line(prevX, prevY, nx, ny, '#7dffb3', 1);
      prevX = nx;
      prevY = ny;
    }
  }

  reset(): void {
    this.watches.clear();
    this.logs.length = 0;
    this.graph.clear();
    this.frames = 0;
    this.updates = 0;
  }
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'boolean' || typeof value === 'string') return String(value);
  if (typeof value === 'object' && value && 'x' in value && 'y' in value) {
    const v = value as { x: number; y: number };
    return `${v.x.toFixed(1)},${v.y.toFixed(1)}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export class PerfMark {
  private readonly samples: number[] = [];
  private readonly capacity: number;

  constructor(capacity = 60) {
    this.capacity = capacity;
  }

  measure(fn: () => void, now: () => number = defaultNow): number {
    const start = now();
    fn();
    const elapsed = now() - start;
    this.samples.push(elapsed);
    if (this.samples.length > this.capacity) this.samples.shift();
    return elapsed;
  }

  get average(): number {
    if (this.samples.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < this.samples.length; i += 1) total += this.samples[i] as number;
    return total / this.samples.length;
  }
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}
