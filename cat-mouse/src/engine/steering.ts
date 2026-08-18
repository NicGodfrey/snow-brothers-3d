import { EPSILON, clamp, vLength, vLimit, vNormalize, vSub, vec2 } from './math';
import type { Vec2 } from './types';

export interface SteerBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function desiredVelocity(from: Vec2, to: Vec2, speed: number): Vec2 {
  const dir = vNormalize(vSub(to, from));
  return { x: dir.x * speed, y: dir.y * speed };
}

export function steerForce(current: Vec2, desired: Vec2, maxForce: number): Vec2 {
  return vLimit({ x: desired.x - current.x, y: desired.y - current.y }, maxForce);
}

export function seek(body: SteerBody, target: Vec2, maxSpeed: number, maxForce: number): Vec2 {
  const desired = desiredVelocity({ x: body.x, y: body.y }, target, maxSpeed);
  return steerForce({ x: body.vx, y: body.vy }, desired, maxForce);
}

export function flee(body: SteerBody, threat: Vec2, maxSpeed: number, maxForce: number): Vec2 {
  const desired = desiredVelocity(threat, { x: body.x, y: body.y }, maxSpeed);
  return steerForce({ x: body.vx, y: body.vy }, desired, maxForce);
}

export function arrive(
  body: SteerBody,
  target: Vec2,
  maxSpeed: number,
  maxForce: number,
  slowingRadius: number,
): Vec2 {
  const offset = vSub(target, { x: body.x, y: body.y });
  const dist = vLength(offset);
  if (dist < EPSILON) return { x: -body.vx, y: -body.vy };
  const speed = dist < slowingRadius ? maxSpeed * (dist / slowingRadius) : maxSpeed;
  const desired = { x: (offset.x / dist) * speed, y: (offset.y / dist) * speed };
  return steerForce({ x: body.vx, y: body.vy }, desired, maxForce);
}

export function pursue(
  body: SteerBody,
  target: SteerBody,
  maxSpeed: number,
  maxForce: number,
): Vec2 {
  const to = vSub({ x: target.x, y: target.y }, { x: body.x, y: body.y });
  const dist = vLength(to);
  const speed = Math.max(vLength({ x: body.vx, y: body.vy }), 1);
  const predict = dist / speed;
  return seek(body, { x: target.x + target.vx * predict, y: target.y + target.vy * predict }, maxSpeed, maxForce);
}

export interface WanderState {
  angle: number;
}

export function wander(
  body: SteerBody,
  state: WanderState,
  dt: number,
  maxSpeed: number,
  maxForce: number,
  jitter = 4,
): Vec2 {
  state.angle += (Math.random() * 2 - 1) * jitter * dt;
  const ahead = {
    x: body.x + body.vx + Math.cos(state.angle) * 16,
    y: body.y + body.vy + Math.sin(state.angle) * 16,
  };
  return seek(body, ahead, maxSpeed, maxForce);
}

export function separate(body: SteerBody, others: readonly SteerBody[], radius: number, maxForce: number): Vec2 {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let i = 0; i < others.length; i += 1) {
    const o = others[i]!;
    if (o === body) continue;
    const dx = body.x - o.x;
    const dy = body.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist < EPSILON || dist >= radius) continue;
    sx += dx / dist;
    sy += dy / dist;
    count += 1;
  }
  if (count === 0) return vec2();
  sx /= count;
  sy /= count;
  return vLimit({ x: sx, y: sy }, maxForce);
}

export function applyForce(body: SteerBody, force: Vec2, maxSpeed: number, dt: number): void {
  body.vx = clamp(body.vx + force.x * dt, -maxSpeed, maxSpeed);
  body.vy = clamp(body.vy + force.y * dt, -maxSpeed, maxSpeed);
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > maxSpeed && speed > EPSILON) {
    body.vx = (body.vx / speed) * maxSpeed;
    body.vy = (body.vy / speed) * maxSpeed;
  }
  body.x += body.vx * dt;
  body.y += body.vy * dt;
}
