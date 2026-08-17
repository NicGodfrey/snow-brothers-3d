import * as THREE from "three";
import type { CaveLevel } from "./level";
import { boxAABB, clamp, disposeObject, type AABB } from "./math";

export type EnemyKind = "mite" | "bat" | "crystal";

export class Enemy {
  readonly mesh: THREE.Group;
  kind: EnemyKind;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  snow = 0;
  readonly snowNeeded: number;
  frozen = false;
  alive = true;
  width = 0.95;
  height = 1.05;
  depth = 0.95;
  private patrolDir = 1;
  private phase: number;

  constructor(scene: THREE.Scene, kind: EnemyKind, x: number, y: number, z: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.z = z;
    this.phase = Math.random() * Math.PI * 2;
    this.snowNeeded = kind === "crystal" ? 4 : kind === "bat" ? 3 : 3;
    this.mesh = this.buildMesh(kind);
    scene.add(this.mesh);
    this.sync();
  }

  private buildMesh(kind: EnemyKind): THREE.Group {
    const g = new THREE.Group();
    if (kind === "mite") {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xc4a484, roughness: 0.85 }),
      );
      body.position.y = 0.45;
      body.castShadow = true;
      g.add(body);
      const shell = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.28),
        new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.7 }),
      );
      shell.position.y = 0.7;
      g.add(shell);
    } else if (kind === "bat") {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.55 }),
      );
      body.position.y = 0.4;
      body.castShadow = true;
      g.add(body);
      const wingL = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.7, 4),
        new THREE.MeshStandardMaterial({ color: 0x5b21b6, roughness: 0.6 }),
      );
      wingL.rotation.z = 1.2;
      wingL.position.set(-0.35, 0.45, 0);
      g.add(wingL);
      const wingR = wingL.clone();
      wingR.rotation.z = -1.2;
      wingR.position.x = 0.35;
      g.add(wingR);
    } else {
      const body = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({
          color: 0x2dd4bf,
          emissive: 0x0f766e,
          emissiveIntensity: 0.35,
          roughness: 0.35,
          metalness: 0.25,
        }),
      );
      body.position.y = 0.55;
      body.castShadow = true;
      g.add(body);
    }
    return g;
  }

  aabb(): AABB {
    return boxAABB(this.x, this.y, this.z, this.width, this.height, this.depth);
  }

  hitBySnow(): void {
    if (this.frozen || !this.alive) return;
    this.snow = Math.min(this.snowNeeded, this.snow + 1);
    if (this.snow >= this.snowNeeded) {
      this.frozen = true;
      this.vx = this.vz = this.vy = 0;
      this.applyFreezeLook(true);
    } else {
      this.applySnowLook();
    }
  }

  private applySnowLook(): void {
    this.mesh.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (!mat?.color) return;
      const t = this.snow / this.snowNeeded;
      mat.color.lerp(new THREE.Color(0xdbeafe), t * 0.65);
    });
  }

  private applyFreezeLook(on: boolean): void {
    this.mesh.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (!mat?.color) return;
      if (on) {
        mat.color.set(0xe0f2fe);
        mat.emissive?.set(0x7dd3fc);
        mat.emissiveIntensity = 0.2;
        mat.roughness = 0.35;
      }
    });
    this.mesh.scale.setScalar(on ? 1.15 : 1);
  }

  update(dt: number, level: CaveLevel): void {
    if (!this.alive || this.frozen) {
      this.sync();
      return;
    }

    this.phase += dt;
    if (this.kind === "bat") {
      this.x += Math.sin(this.phase * 1.4) * 2.4 * dt;
      this.z += Math.cos(this.phase * 0.9) * 1.6 * dt;
      this.y = 2.2 + Math.sin(this.phase * 2.2) * 0.55 + (this.y > 3 ? 0 : 0);
      // keep bats near mid height platforms
      this.y = clamp(this.y, 1.8, 6.8);
    } else if (this.kind === "crystal") {
      this.x += this.patrolDir * 2.1 * dt;
      if (this.x > 8 || this.x < -8) this.patrolDir *= -1;
      this.vy -= 18 * dt;
      this.y += this.vy * dt;
      this.ground(level);
    } else {
      this.x += this.patrolDir * 2.8 * dt;
      this.z += Math.sin(this.phase) * 0.8 * dt;
      if (this.x > 9 || this.x < -9) this.patrolDir *= -1;
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      this.ground(level);
    }

    this.x = clamp(this.x, level.bounds.minX + 0.5, level.bounds.maxX - 0.5);
    this.z = clamp(this.z, level.bounds.minZ + 0.5, level.bounds.maxZ - 0.5);
    this.sync();
  }

  private ground(level: CaveLevel): void {
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      return;
    }
    if (this.vy > 0) return;
    for (const p of level.platforms) {
      const withinX = this.x > p.x - p.w / 2 && this.x < p.x + p.w / 2;
      const withinZ = this.z > p.z - p.d / 2 && this.z < p.z + p.d / 2;
      const top = p.y + p.h;
      if (withinX && withinZ && this.y >= top - 0.4 && this.y <= top + 0.2) {
        this.y = top;
        this.vy = 0;
        return;
      }
    }
  }

  private sync(): void {
    this.mesh.position.set(this.x, this.y, this.z);
    if (this.kind === "crystal") this.mesh.rotation.y += 0.02;
    if (this.kind === "bat") this.mesh.rotation.y = Math.sin(this.phase) * 0.4;
  }

  destroy(): void {
    this.alive = false;
    disposeObject(this.mesh);
    this.mesh.removeFromParent();
  }
}
