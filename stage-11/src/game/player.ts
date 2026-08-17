import * as THREE from "three";
import type { Input } from "./input";
import type { CaveLevel } from "./level";
import { boxAABB, clamp, type AABB } from "./math";

export class Player {
  readonly mesh: THREE.Group;
  x = 0;
  y = 0.1;
  z = 4;
  vx = 0;
  vy = 0;
  vz = 0;
  facing = 1;
  onGround = false;
  width = 0.9;
  height = 1.35;
  depth = 0.9;
  private throwCooldown = 0;
  private invuln = 0;

  constructor(scene: THREE.Scene) {
    this.mesh = this.buildMesh();
    scene.add(this.mesh);
    this.syncMesh();
  }

  private buildMesh(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xf0f7ff, roughness: 0.65 }),
    );
    body.position.y = 0.55;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }),
    );
    head.position.y = 1.15;
    head.castShadow = true;
    g.add(head);

    const overalls = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.48, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.7 }),
    );
    overalls.position.y = 0.4;
    g.add(overalls);

    const eyeL = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x111827 }),
    );
    eyeL.position.set(-0.1, 1.2, 0.28);
    g.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;
    g.add(eyeR);

    const carrot = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 }),
    );
    carrot.rotation.x = Math.PI / 2;
    carrot.position.set(0, 1.12, 0.38);
    g.add(carrot);

    return g;
  }

  aabb(): AABB {
    return boxAABB(this.x, this.y, this.z, this.width, this.height, this.depth);
  }

  update(dt: number, input: Input, level: CaveLevel): void {
    const speed = 7.2;
    let ix = 0;
    let iz = 0;
    if (input.pressed("KeyA", "ArrowLeft")) ix -= 1;
    if (input.pressed("KeyD", "ArrowRight")) ix += 1;
    if (input.pressed("KeyW", "ArrowUp")) iz -= 1;
    if (input.pressed("KeyS", "ArrowDown")) iz += 1;

    if (ix !== 0 || iz !== 0) {
      const len = Math.hypot(ix, iz) || 1;
      this.vx = (ix / len) * speed;
      this.vz = (iz / len) * speed;
      if (ix !== 0) this.facing = Math.sign(ix);
    } else {
      this.vx *= Math.pow(0.001, dt);
      this.vz *= Math.pow(0.001, dt);
    }

    if (this.onGround && input.pressed("Space")) {
      this.vy = 9.2;
      this.onGround = false;
    }

    this.vy -= 22 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    this.resolvePlatforms(level);
    this.x = clamp(this.x, level.bounds.minX + 0.4, level.bounds.maxX - 0.4);
    this.z = clamp(this.z, level.bounds.minZ + 0.4, level.bounds.maxZ - 0.4);

    if (this.y < 0) {
      this.y = 0;
      this.vy = 0;
      this.onGround = true;
    }

    this.throwCooldown = Math.max(0, this.throwCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.syncMesh();
  }

  private resolvePlatforms(level: CaveLevel): void {
    this.onGround = this.y <= 0.001;
    if (this.vy > 0) return;

    for (const p of level.platforms) {
      const withinX = this.x > p.x - p.w / 2 && this.x < p.x + p.w / 2;
      const withinZ = this.z > p.z - p.d / 2 && this.z < p.z + p.d / 2;
      const top = p.y + p.h;
      if (withinX && withinZ && this.y >= top - 0.35 && this.y <= top + 0.15) {
        this.y = top;
        this.vy = 0;
        this.onGround = true;
        break;
      }
    }
  }

  canThrow(): boolean {
    return this.throwCooldown <= 0;
  }

  markThrow(): void {
    this.throwCooldown = 0.22;
  }

  hurt(): boolean {
    if (this.invuln > 0) return false;
    this.invuln = 1.2;
    this.vy = 5;
    this.vx = -this.facing * 4;
    return true;
  }

  get isInvulnerable(): boolean {
    return this.invuln > 0;
  }

  private syncMesh(): void {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.scale.x = this.facing;
    this.mesh.visible = !(this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0);
  }

  reset(): void {
    this.x = 0;
    this.y = 0.1;
    this.z = 4;
    this.vx = this.vy = this.vz = 0;
    this.facing = 1;
    this.throwCooldown = 0;
    this.invuln = 0;
    this.syncMesh();
  }
}
