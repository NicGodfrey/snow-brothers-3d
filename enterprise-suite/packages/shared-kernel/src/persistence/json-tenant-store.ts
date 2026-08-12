import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Tiny file-backed, tenant-keyed map used by the local/pilot suite so a restart
 * does not wipe demo data. Not a database — atomic write via temp+rename, one
 * JSON file per store name under PERSISTENCE_DIR (default `.data`).
 */

export type JsonReviver<T> = (raw: unknown) => T;
export type JsonSerializer<T> = (value: T) => unknown;

export interface JsonTenantStoreOptions<T> {
  readonly service: string;
  readonly name: string;
  readonly dir?: string;
  readonly serialize?: JsonSerializer<T>;
  readonly revive: JsonReviver<T>;
  /** When false, the store stays in-memory only (tests). Default: env-driven. */
  readonly enabled?: boolean;
}

function persistenceEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (process.env.PERSISTENCE === "0" || process.env.PERSISTENCE === "false") return false;
  return process.env.PERSISTENCE !== "0";
}

function persistenceDir(override?: string): string {
  return override ?? process.env.PERSISTENCE_DIR ?? join(process.cwd(), ".data");
}

/** Revive an AggregateRoot/Entity subclass from its `toJSON()` shape. */
export function reviveEntity<T extends object>(prototype: object, snapshot: unknown): T {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("reviveEntity: snapshot must be an object");
  }
  const raw = snapshot as Record<string, unknown>;
  const { id, tenantId, createdAt, updatedAt, version, ...props } = raw;
  if (typeof id !== "string" || typeof tenantId !== "string") {
    throw new Error("reviveEntity: snapshot missing id/tenantId");
  }
  const entity = Object.create(prototype) as Record<string, unknown>;
  entity.id = id;
  entity.tenantId = tenantId;
  entity.createdAt = createdAt;
  entity.updatedAt = updatedAt;
  entity.version = typeof version === "number" ? version : 1;
  entity.props = props;
  entity.pending = [];
  return entity as T;
}

export class JsonTenantStore<T> {
  private readonly byTenant = new Map<string, Map<string, T>>();
  private readonly filePath: string;
  private readonly enabled: boolean;
  private readonly serialize: JsonSerializer<T>;
  private readonly revive: JsonReviver<T>;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: JsonTenantStoreOptions<T>) {
    this.enabled = persistenceEnabled(options.enabled);
    this.revive = options.revive;
    this.serialize =
      options.serialize ??
      ((value) =>
        typeof (value as { toJSON?: () => unknown }).toJSON === "function"
          ? (value as { toJSON: () => unknown }).toJSON()
          : value);
    const dir = join(persistenceDir(options.dir), options.service);
    this.filePath = join(dir, `${options.name}.json`);
    if (this.enabled) this.load();
  }

  get enabledPersistence(): boolean {
    return this.enabled;
  }

  get file(): string {
    return this.filePath;
  }

  isEmpty(): boolean {
    for (const bucket of this.byTenant.values()) {
      if (bucket.size > 0) return false;
    }
    return true;
  }

  tenantCount(): number {
    return this.byTenant.size;
  }

  get(tenantId: string, id: string): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  set(tenantId: string, id: string, value: T): void {
    let bucket = this.byTenant.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(tenantId, bucket);
    }
    bucket.set(id, value);
    this.scheduleFlush();
  }

  delete(tenantId: string, id: string): boolean {
    const ok = this.byTenant.get(tenantId)?.delete(id) ?? false;
    if (ok) this.scheduleFlush();
    return ok;
  }

  values(tenantId: string): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }

  flush(): void {
    if (!this.enabled) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.write();
  }

  private scheduleFlush(): void {
    if (!this.enabled) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.write();
    }, 50);
    this.timer.unref?.();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as {
        tenants?: Record<string, Record<string, unknown>>;
      };
      const tenants = parsed.tenants ?? {};
      for (const [tenantId, rows] of Object.entries(tenants)) {
        const bucket = new Map<string, T>();
        for (const [id, raw] of Object.entries(rows)) {
          bucket.set(id, this.revive(raw));
        }
        this.byTenant.set(tenantId, bucket);
      }
    } catch (err) {
      console.warn(`[persistence] failed to load ${this.filePath}: ${err}`);
    }
  }

  private write(): void {
    if (!this.enabled || !this.dirty) return;
    this.dirty = false;
    const tenants: Record<string, Record<string, unknown>> = {};
    for (const [tenantId, bucket] of this.byTenant) {
      const rows: Record<string, unknown> = {};
      for (const [id, value] of bucket) {
        rows[id] = this.serialize(value);
      }
      tenants[tenantId] = rows;
    }
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, tenants }, null, 0));
    renameSync(tmp, this.filePath);
  }
}
