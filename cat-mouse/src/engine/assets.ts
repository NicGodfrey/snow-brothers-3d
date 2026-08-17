export interface AssetProgress {
  loaded: number;
  total: number;
  failed: number;
}

/**
 * Tiny cache for images, JSON and text. Failed loads are recorded so a retry
 * can skip or re-request without throwing during gameplay.
 */
export class AssetLoader {
  private readonly cache = new Map<string, unknown>();
  private readonly failed = new Set<string>();
  private pending = 0;
  private finished = 0;
  private errors = 0;

  get progress(): number {
    const total = this.finished + this.pending;
    return total === 0 ? 1 : this.finished / total;
  }

  snapshot(): AssetProgress {
    return { loaded: this.finished, total: this.finished + this.pending, failed: this.errors };
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined) throw new Error(`Asset not loaded: ${key}`);
    return value;
  }

  put<T>(key: string, value: T): T {
    this.cache.set(key, value);
    return value;
  }

  async json<T>(url: string, key = url): Promise<T> {
    return this.load(key, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      return (await res.json()) as T;
    });
  }

  async text(url: string, key = url): Promise<string> {
    return this.load(key, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      return res.text();
    });
  }

  async image(url: string, key = url): Promise<HTMLImageElement> {
    return this.load(key, () => loadImage(url));
  }

  async all<T>(jobs: readonly Promise<T>[]): Promise<T[]> {
    return Promise.all(jobs);
  }

  failedKeys(): string[] {
    return [...this.failed].sort();
  }

  private async load<T>(key: string, factory: () => Promise<T>): Promise<T> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    this.pending += 1;
    try {
      const value = await factory();
      this.cache.set(key, value);
      this.failed.delete(key);
      return value;
    } catch (err) {
      this.failed.add(key);
      this.errors += 1;
      throw err;
    } finally {
      this.pending -= 1;
      this.finished += 1;
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image is not available in this environment'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

export function makeAssets(): AssetLoader {
  return new AssetLoader();
}
