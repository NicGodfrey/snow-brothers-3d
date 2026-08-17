import * as THREE from "three";
import { Input } from "./input";
import { CaveLevel } from "./level";
import { Player } from "./player";
import { Enemy, type EnemyKind } from "./enemy";
import { SnowShot, Snowball } from "./snow";
import { overlaps } from "./math";

type Spawn = { kind: EnemyKind; x: number; y: number; z: number };

const STAGE_SPAWNS: Spawn[] = [
  { kind: "mite", x: -6.5, y: 2.3, z: -2.5 },
  { kind: "mite", x: 6.5, y: 2.3, z: -2.5 },
  { kind: "mite", x: 0, y: 0.1, z: -1 },
  { kind: "bat", x: -3, y: 4.2, z: 0.5 },
  { kind: "bat", x: 3.5, y: 5.0, z: -1.5 },
  { kind: "crystal", x: -7, y: 5.5, z: 2.5 },
  { kind: "crystal", x: 7, y: 5.5, z: 2.5 },
  { kind: "crystal", x: 0, y: 6.9, z: -3.2 },
];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private input = new Input();
  private level!: CaveLevel;
  private player!: Player;
  private enemies: Enemy[] = [];
  private shots: SnowShot[] = [];
  private balls: Snowball[] = [];
  private statusEl: HTMLElement;
  private overlay: HTMLElement;
  private overlayTitle: HTMLElement;
  private overlaySub: HTMLElement;
  private running = true;
  private won = false;
  private lost = false;
  private lives = 3;
  private clock = new THREE.Clock();
  private kickLatch = false;
  private throwLatch = false;

  constructor(canvas: HTMLCanvasElement) {
    this.statusEl = document.getElementById("hud-status")!;
    this.overlay = document.getElementById("overlay")!;
    this.overlayTitle = document.getElementById("overlay-title")!;
    this.overlaySub = document.getElementById("overlay-sub")!;
    document.getElementById("restart-btn")!.addEventListener("click", () => this.restart());

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    this.camera.position.set(0, 11.5, 16);
    this.camera.lookAt(0, 3.2, 0);

    window.addEventListener("resize", () => this.onResize());
    this.bootstrapScene();
    this.spawnStage();
    this.setStatus();
  }

  private bootstrapScene(): void {
    this.scene.background = new THREE.Color(0x071018);
    this.scene.fog = new THREE.FogExp2(0x0b1622, 0.028);

    const hemi = new THREE.HemisphereLight(0x9fd4ff, 0x1a1520, 0.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffd7a8, 0.85);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x5eead4, 0.25);
    fill.position.set(-8, 6, -4);
    this.scene.add(fill);
  }

  private spawnStage(): void {
    this.level = new CaveLevel(this.scene);
    this.player = new Player(this.scene);
    for (const s of STAGE_SPAWNS) {
      this.enemies.push(new Enemy(this.scene, s.kind, s.x, s.y, s.z));
    }
  }

  private clearActors(): void {
    for (const e of this.enemies) e.destroy();
    for (const s of this.shots) s.destroy();
    for (const b of this.balls) b.destroy();
    this.enemies = [];
    this.shots = [];
    this.balls = [];
    this.player.mesh.removeFromParent();
    this.level.dispose();
  }

  restart(): void {
    this.overlay.classList.add("hidden");
    this.clearActors();
    this.lives = 3;
    this.won = false;
    this.lost = false;
    this.running = true;
    this.spawnStage();
    this.setStatus();
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.033, this.clock.getDelta());
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(dt: number): void {
    if (!this.running) return;

    this.player.update(dt, this.input, this.level);
    this.handleThrow();
    this.handleKick();

    for (const e of this.enemies) e.update(dt, this.level);

    for (const shot of this.shots) {
      shot.update(dt, this.level);
      if (!shot.alive) continue;
      for (const e of this.enemies) {
        if (!e.alive || e.frozen) continue;
        if (overlaps(shot.aabb(), e.aabb())) {
          e.hitBySnow();
          shot.destroy();
          if (e.frozen) this.convertToBall(e);
          break;
        }
      }
    }

    for (const ball of this.balls) {
      ball.update(dt, this.level, this.enemies, (e) => this.defeatEnemy(e));
    }

    this.shots = this.shots.filter((s) => s.alive);
    this.balls = this.balls.filter((b) => b.alive);
    this.enemies = this.enemies.filter((e) => e.alive);

    this.checkPlayerHits();
    this.checkWin();
    this.setStatus();
  }

  private handleThrow(): void {
    const wants = this.input.pressed("KeyJ", "KeyZ");
    if (wants && !this.throwLatch && this.player.canThrow()) {
      this.player.markThrow();
      this.shots.push(
        new SnowShot(
          this.scene,
          this.player.x + this.player.facing * 0.55,
          this.player.y,
          this.player.z,
          this.player.facing,
        ),
      );
    }
    this.throwLatch = wants;
  }

  private handleKick(): void {
    const wants = this.input.pressed("KeyK", "KeyX");
    if (wants && !this.kickLatch) {
      let best: Snowball | null = null;
      let bestDist = 1.6;
      for (const b of this.balls) {
        if (!b.alive || b.rolling) continue;
        const d = Math.hypot(b.x - this.player.x, b.z - this.player.z, b.y - this.player.y);
        if (d < bestDist) {
          best = b;
          bestDist = d;
        }
      }
      if (best) {
        const dirX = this.player.facing;
        const dirZ =
          Math.abs(this.player.vz) > 0.4 ? Math.sign(this.player.vz) : 0;
        best.kick(dirX, dirZ === 0 ? 0 : dirZ * 0.35);
      }
    }
    this.kickLatch = wants;
  }

  private convertToBall(enemy: Enemy): void {
    const ball = new Snowball(this.scene, enemy);
    this.balls.push(ball);
    enemy.destroy();
  }

  private defeatEnemy(enemy: Enemy): void {
    if (!enemy.alive) return;
    if (enemy.frozen) {
      // already a ball elsewhere
    }
    enemy.destroy();
  }

  private checkPlayerHits(): void {
    if (this.player.isInvulnerable) return;
    for (const e of this.enemies) {
      if (!e.alive || e.frozen) continue;
      if (overlaps(this.player.aabb(), e.aabb())) {
        if (this.player.hurt()) {
          this.lives -= 1;
          if (this.lives <= 0) this.fail();
        }
        break;
      }
    }
  }

  private checkWin(): void {
    // Arcade rule: stage clears once every enemy is gone (snowballs are debris / score tools).
    if (!this.won && this.enemies.every((e) => !e.alive) && this.enemies.length === 0) {
      this.win();
    }
  }

  private win(): void {
    this.won = true;
    this.running = false;
    this.overlayTitle.textContent = "STAGE CLEAR";
    this.overlaySub.textContent = "Crystal Cavern secured — World 2 begins";
    this.overlay.classList.remove("hidden");
  }

  private fail(): void {
    this.lost = true;
    this.running = false;
    this.overlayTitle.textContent = "TRY AGAIN";
    this.overlaySub.textContent = "The cavern reclaims the path";
    this.overlay.classList.remove("hidden");
  }

  private setStatus(): void {
    if (this.won) {
      this.statusEl.textContent = "Stage 11 clear!";
      return;
    }
    if (this.lost) {
      this.statusEl.textContent = "Out of lives";
      return;
    }
    const foes = this.enemies.length;
    const balls = this.balls.filter((b) => b.alive).length;
    this.statusEl.textContent = `Lives ${this.lives} · Foes ${foes} · Snowballs ${balls}`;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
