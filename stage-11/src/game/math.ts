import * as THREE from "three";

export type AABB = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export function boxAABB(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): AABB {
  const hw = w / 2;
  const hd = d / 2;
  return {
    minX: x - hw,
    maxX: x + hw,
    minY: y,
    maxY: y + h,
    minZ: z - hd,
    maxZ: z + hd,
  };
}

export function overlaps(a: AABB, b: AABB): boolean {
  return (
    a.minX <= b.maxX &&
    a.maxX >= b.minX &&
    a.minY <= b.maxY &&
    a.maxY >= b.minY &&
    a.minZ <= b.maxZ &&
    a.maxZ >= b.minZ
  );
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
}
