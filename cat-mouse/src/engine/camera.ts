import { clamp, damp, lerp } from './math';
import type { Bounds, Camera, Rect, Vec2 } from './types';

export interface FollowCameraOptions {
  viewportWidth: number;
  viewportHeight: number;
  zoom?: number;
  /** Exponential follow rate. Higher snaps harder. */
  stiffness?: number;
  lookAhead?: number;
  maxLookAhead?: number;
  shakeDecay?: number;
  maxShake?: number;
}

/**
 * Centre-anchored camera. `x/y` is the world point drawn at the viewport
 * centre. Shake is trauma in [0,1]; offset is trauma² times `maxShake`.
 */
export class FollowCamera implements Camera {
  x: number;
  y: number;
  zoom: number;
  shake: number;
  viewportWidth: number;
  viewportHeight: number;
  stiffness: number;
  lookAhead: number;
  maxLookAhead: number;
  shakeDecay: number;
  maxShake: number;
  private targetX: number;
  private targetY: number;
  private aheadX = 0;
  private aheadY = 0;
  private shakeX = 0;
  private shakeY = 0;
  private elapsed = 0;
  private bounds: Bounds | null = null;

  constructor(options: FollowCameraOptions) {
    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.zoom = options.zoom ?? 1;
    this.stiffness = options.stiffness ?? 8;
    this.lookAhead = options.lookAhead ?? 0.18;
    this.maxLookAhead = options.maxLookAhead ?? 48;
    this.shakeDecay = options.shakeDecay ?? 3.2;
    this.maxShake = options.maxShake ?? 10;
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.shake = 0;
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  setZoom(zoom: number): void {
    this.zoom = clamp(zoom, 0.25, 8);
  }

  setBounds(bounds: Bounds | null): void {
    this.bounds = bounds;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.aheadX = 0;
    this.aheadY = 0;
    this.clampInBounds();
  }

  follow(x: number, y: number, vx = 0, vy = 0): void {
    this.targetX = x;
    this.targetY = y;
    this.aheadX = clamp(vx * this.lookAhead, -this.maxLookAhead, this.maxLookAhead);
    this.aheadY = clamp(vy * this.lookAhead, -this.maxLookAhead, this.maxLookAhead);
  }

  addShake(trauma: number): void {
    this.shake = clamp(this.shake + trauma, 0, 1);
  }

  setShake(trauma: number): void {
    this.shake = clamp(trauma, 0, 1);
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.x = damp(this.x, this.targetX + this.aheadX, this.stiffness, dt);
    this.y = damp(this.y, this.targetY + this.aheadY, this.stiffness, dt);
    this.shake = approachZero(this.shake, this.shakeDecay * dt);
    const mag = this.shake * this.shake * this.maxShake;
    this.shakeX = mag * noise(this.elapsed, 1);
    this.shakeY = mag * noise(this.elapsed, 2);
    this.clampInBounds();
  }

  viewRect(): Rect {
    const w = this.viewportWidth / this.zoom;
    const h = this.viewportHeight / this.zoom;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }

  worldToScreen(worldX: number, worldY: number): Vec2 {
    return {
      x: (worldX - this.x) * this.zoom + this.viewportWidth / 2 + this.shakeX,
      y: (worldY - this.y) * this.zoom + this.viewportHeight / 2 + this.shakeY,
    };
  }

  screenToWorld(screenX: number, screenY: number): Vec2 {
    return {
      x: (screenX - this.viewportWidth / 2 - this.shakeX) / this.zoom + this.x,
      y: (screenY - this.viewportHeight / 2 - this.shakeY) / this.zoom + this.y,
    };
  }

  containsWorld(x: number, y: number, padding = 0): boolean {
    const r = this.viewRect();
    return x >= r.x - padding && x <= r.x + r.w + padding && y >= r.y - padding && y <= r.y + r.h + padding;
  }

  offset(): Vec2 {
    return { x: this.shakeX, y: this.shakeY };
  }

  lerpView(from: Vec2, t: number): void {
    this.snapTo(lerp(from.x, this.targetX, t), lerp(from.y, this.targetY, t));
  }

  private clampInBounds(): void {
    const b = this.bounds;
    if (!b) return;
    const halfW = this.viewportWidth / (2 * this.zoom);
    const halfH = this.viewportHeight / (2 * this.zoom);
    const minX = b.minX + halfW;
    const maxX = b.maxX - halfW;
    const minY = b.minY + halfH;
    const maxY = b.maxY - halfH;
    this.x = minX > maxX ? (b.minX + b.maxX) / 2 : clamp(this.x, minX, maxX);
    this.y = minY > maxY ? (b.minY + b.maxY) / 2 : clamp(this.y, minY, maxY);
  }
}

function approachZero(value: number, delta: number): number {
  if (value <= delta) return 0;
  return value - delta;
}

function noise(t: number, salt: number): number {
  const n = Math.sin(t * 23.17 + salt * 19.13) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

export function makeCamera(width: number, height: number, zoom = 1): FollowCamera {
  return new FollowCamera({ viewportWidth: width, viewportHeight: height, zoom });
}
