import type { ParticleSpec, RendererLike } from './types';

export interface Particle extends ParticleSpec {
  age: number;
  alive: boolean;
}

export interface BurstOptions {
  count: number;
  x: number;
  y: number;
  color: string;
  life?: number;
  size?: number;
  speed?: number;
  drag?: number;
  gravity?: number;
  spread?: number;
}

const DEFAULT_CAPACITY = 512;

/**
 * Object-pooled 2D particles. Dead slots are recycled so bursts stay cheap.
 */
export class ParticleSystem {
  private readonly pool: Particle[] = [];
  private live = 0;
  readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    for (let i = 0; i < capacity; i += 1) {
      this.pool.push(deadParticle());
    }
  }

  get count(): number {
    return this.live;
  }

  emit(spec: ParticleSpec): Particle | null {
    const slot = this.acquire();
    if (!slot) return null;
    slot.x = spec.x;
    slot.y = spec.y;
    slot.vx = spec.vx;
    slot.vy = spec.vy;
    slot.life = spec.life;
    slot.size = spec.size;
    slot.color = spec.color;
    slot.drag = spec.drag ?? 1.8;
    slot.gravity = spec.gravity ?? 0;
    slot.age = 0;
    slot.alive = true;
    this.live += 1;
    return slot;
  }

  burst(options: BurstOptions): number {
    const life = options.life ?? 0.45;
    const size = options.size ?? 2.5;
    const speed = options.speed ?? 40;
    const spread = options.spread ?? Math.PI * 2;
    let spawned = 0;
    for (let i = 0; i < options.count; i += 1) {
      const angle = (i / Math.max(1, options.count)) * spread + Math.random() * 0.4;
      const mag = speed * (0.45 + Math.random() * 0.55);
      const particle = this.emit({
        x: options.x,
        y: options.y,
        vx: Math.cos(angle) * mag,
        vy: Math.sin(angle) * mag,
        life,
        size: size * (0.7 + Math.random() * 0.6),
        color: options.color,
        drag: options.drag,
        gravity: options.gravity,
      });
      if (particle) spawned += 1;
    }
    return spawned;
  }

  crumb(x: number, y: number): void {
    this.burst({ count: 6, x, y, color: '#e8c36a', life: 0.5, size: 2, speed: 28, gravity: 18 });
  }

  dust(x: number, y: number): void {
    this.burst({ count: 8, x, y, color: '#c4b8a0', life: 0.35, size: 1.8, speed: 22, drag: 4 });
  }

  splash(x: number, y: number): void {
    this.burst({ count: 10, x, y, color: '#6ec4ff', life: 0.4, size: 2.2, speed: 36, gravity: 40 });
  }

  sparks(x: number, y: number): void {
    this.burst({ count: 12, x, y, color: '#ffe28a', life: 0.28, size: 1.6, speed: 70, drag: 1.2 });
  }

  update(dt: number): void {
    if (dt <= 0 || this.live === 0) return;
    let live = 0;
    for (let i = 0; i < this.pool.length; i += 1) {
      const p = this.pool[i]!;
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const drag = Math.exp(-(p.drag ?? 0) * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vy += (p.gravity ?? 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      live += 1;
    }
    this.live = live;
  }

  draw(renderer: RendererLike): void {
    for (let i = 0; i < this.pool.length; i += 1) {
      const p = this.pool[i]!;
      if (!p.alive) continue;
      const t = 1 - p.age / p.life;
      renderer.sprite({
        x: p.x,
        y: p.y,
        w: p.size,
        h: p.size,
        color: p.color,
        alpha: t,
        layer: 40,
      });
    }
  }

  clear(): void {
    for (let i = 0; i < this.pool.length; i += 1) this.pool[i]!.alive = false;
    this.live = 0;
  }

  forEach(visit: (particle: Particle) => void): void {
    for (let i = 0; i < this.pool.length; i += 1) {
      const p = this.pool[i]!;
      if (p.alive) visit(p);
    }
  }

  private acquire(): Particle | null {
    for (let i = 0; i < this.pool.length; i += 1) {
      if (!this.pool[i]!.alive) return this.pool[i]!;
    }
    return null;
  }
}

function deadParticle(): Particle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    size: 1,
    color: '#fff',
    drag: 0,
    gravity: 0,
    age: 0,
    alive: false,
  };
}
