import * as THREE from "three";
import type { CaveLevel } from "./level";
import { boxAABB, clamp, disposeObject, overlaps, type AABB } from "./math";
import type { Enemy } from "./enemy";

export class SnowShot {
  readonly mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  alive = true;
  life = 0.85;

  constructor(scene: THREE.Scene, x: number, y: number, z: number, facing: number) {
    this.x = x;
    this.y = y + 0.7;
    this.z = z;
    this.vx = facing * 14;
    this.vz = 0;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0x7dd3fc,
        emissiveIntensity: 0.4,
        roughness: 0.4,
      }),
    );
    scene.add(this.mesh);
    this.sync();
  }

  aabb(): AABB {
    return boxAABB(this.x, this.y, this.z, 0.35, 0.35, 0.35);
  }

  update(dt: number, level: CaveLevel): void {
    this.life -= dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (
      this.life <= 0 ||
      this.x < level.bounds.minX ||
      this.x > level.bounds.maxX
    ) {
      this.destroy();
      return;
    }
    this.sync();
  }

  private sync(): void {
    this.mesh.position.set(this.x, this.y, this.z);
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    disposeObject(this.mesh);
    this.mesh.removeFromParent();
  }
}

export class Snowball {
  readonly mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vz = 0;
  rolling = false;
  alive = true;
  width = 1.15;
  height = 1.15;
  depth = 1.15;
  private life = 4;

  constructor(scene: THREE.Scene, enemy: Enemy) {
    this.x = enemy.x;
    this.y = enemy.y;
    this.z = enemy.z;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        emissive: 0xbae6fd,
        emissiveIntensity: 0.15,
        roughness: 0.45,
      }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.sync();
  }

  aabb(): AABB {
    return boxAABB(this.x, this.y, this.z, this.width, this.height, this.depth);
  }

  kick(dirX: number, dirZ: number): void {
    const len = Math.hypot(dirX, dirZ) || 1;
    this.vx = (dirX / len) * 13;
    this.vz = (dirZ / len) * 13;
    this.rolling = true;
    this.life = 3.5;
  }

  update(dt: number, level: CaveLevel, enemies: Enemy[], onHit: (e: Enemy) => void): void {
    if (!this.alive) return;

    if (this.rolling) {
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.life -= dt;
      this.mesh.rotation.z -= this.vx * dt * 1.5;
      this.mesh.rotation.x += this.vz * dt * 1.5;

      // Bounce off room bounds
      if (this.x < level.bounds.minX + 0.6 || this.x > level.bounds.maxX - 0.6) {
        this.vx *= -1;
        this.x = clamp(this.x, level.bounds.minX + 0.6, level.bounds.maxX - 0.6);
      }
      if (this.z < level.bounds.minZ + 0.6 || this.z > level.bounds.maxZ - 0.6) {
        this.vz *= -1;
        this.z = clamp(this.z, level.bounds.minZ + 0.6, level.bounds.maxZ - 0.6);
      }

      for (const e of enemies) {
        if (!e.alive) continue;
        if (overlaps(this.aabb(), e.aabb())) onHit(e);
      }

      if (this.life <= 0) this.destroy();
    }

    this.sync();
  }

  private sync(): void {
    this.mesh.position.set(this.x, this.y + 0.55, this.z);
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    disposeObject(this.mesh);
    this.mesh.removeFromParent();
  }
}
