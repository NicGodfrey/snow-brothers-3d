import * as THREE from "three";
import { disposeObject } from "./math";

export type Platform = {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
};

export class CaveLevel {
  readonly group = new THREE.Group();
  readonly platforms: Platform[] = [];
  readonly bounds = { minX: -11, maxX: 11, minZ: -8, maxZ: 8 };

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildRoom();
    this.buildPlatforms();
    this.buildCrystals();
    this.buildTorches();
  }

  private addBox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number,
    rough = 0.92,
  ): Platform {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const platform: Platform = { mesh, x, y, z, w, h, d };
    this.platforms.push(platform);
    return platform;
  }

  private buildRoom(): void {
    // Floor
    this.addBox(24, 0.6, 18, 0, -0.6, 0, 0x2a3540, 1);

    // Back / side walls (visual only — collision via bounds)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1a2430,
      roughness: 1,
      metalness: 0.05,
    });

    const back = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 0.8), wallMat);
    back.position.set(0, 4.4, -9);
    back.receiveShadow = true;
    this.group.add(back);

    const left = new THREE.Mesh(new THREE.BoxGeometry(0.8, 10, 18), wallMat.clone());
    left.position.set(-12, 4.4, 0);
    this.group.add(left);

    const right = new THREE.Mesh(new THREE.BoxGeometry(0.8, 10, 18), wallMat.clone());
    right.position.set(12, 4.4, 0);
    this.group.add(right);

    // Ceiling slab with opening feel
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.5, 18),
      new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 1 }),
    );
    ceiling.position.set(0, 9.2, 0);
    this.group.add(ceiling);

    // Stalactites
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(
        new THREE.ConeGeometry(0.25 + Math.random() * 0.25, 0.9 + Math.random(), 6),
        new THREE.MeshStandardMaterial({ color: 0x3a4a58, roughness: 1 }),
      );
      s.rotation.x = Math.PI;
      s.position.set(-9 + i * 2, 8.7, -6 + (i % 3) * 3);
      this.group.add(s);
    }
  }

  private buildPlatforms(): void {
    // Classic Snow Bros stacked ledges, remixed for a cave chamber
    this.addBox(5.5, 0.45, 2.2, -6.5, 1.8, -2.5, 0x3d4b58);
    this.addBox(5.5, 0.45, 2.2, 6.5, 1.8, -2.5, 0x3d4b58);
    this.addBox(7.5, 0.45, 2.4, 0, 3.4, 1.2, 0x455566);
    this.addBox(4.2, 0.45, 2.0, -7.2, 5.0, 2.5, 0x3d4b58);
    this.addBox(4.2, 0.45, 2.0, 7.2, 5.0, 2.5, 0x3d4b58);
    this.addBox(6.0, 0.45, 2.2, 0, 6.4, -3.2, 0x4a5d6e);

    // Center stepping stones
    this.addBox(2.2, 0.4, 2.2, -3.2, 1.7, 3.5, 0x516273);
    this.addBox(2.2, 0.4, 2.2, 3.2, 1.7, 3.5, 0x516273);
  }

  private buildCrystals(): void {
    const colors = [0x5eead4, 0x67e8f9, 0xa78bfa, 0x38bdf8];
    const spots: Array<[number, number, number]> = [
      [-10, 0.2, -7],
      [10, 0.2, -7],
      [-4, 3.5, 1.2],
      [4, 3.5, 1.2],
      [0, 6.5, -3.2],
      [-8, 5.1, 2.5],
      [8, 5.1, 2.5],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [x, y, z] = spots[i];
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.35 + (i % 3) * 0.08, 0),
        new THREE.MeshStandardMaterial({
          color: colors[i % colors.length],
          emissive: colors[i % colors.length],
          emissiveIntensity: 0.45,
          roughness: 0.25,
          metalness: 0.3,
          transparent: true,
          opacity: 0.92,
        }),
      );
      crystal.position.set(x, y + 0.5, z);
      crystal.rotation.y = i * 0.7;
      this.group.add(crystal);

      const glow = new THREE.PointLight(colors[i % colors.length], 0.55, 5, 2);
      glow.position.copy(crystal.position);
      this.group.add(glow);
    }
  }

  private buildTorches(): void {
    const posts: Array<[number, number, number]> = [
      [-11.2, 2.2, -4],
      [11.2, 2.2, -4],
      [-11.2, 2.2, 4],
      [11.2, 2.2, 4],
    ];
    for (const [x, y, z] of posts) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 1 }),
      );
      pole.position.set(x, y, z);
      this.group.add(pole);

      const flame = new THREE.PointLight(0xff9a4a, 1.1, 8, 2);
      flame.position.set(x, y + 0.7, z);
      flame.castShadow = true;
      this.group.add(flame);
    }
  }

  dispose(): void {
    disposeObject(this.group);
    this.group.removeFromParent();
  }
}
