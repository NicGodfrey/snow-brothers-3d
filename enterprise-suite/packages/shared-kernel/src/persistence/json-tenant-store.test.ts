import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JsonTenantStore, reviveEntity } from "./json-tenant-store.js";

class DemoEntity {
  readonly id: string;
  readonly tenantId: string;
  version: number;
  props: { name: string };
  pending: unknown[] = [];

  constructor(tenantId: string, id: string, name: string) {
    this.tenantId = tenantId;
    this.id = id;
    this.version = 1;
    this.props = { name };
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: this.version,
      name: this.props.name,
    };
  }

  greet(): string {
    return `hi ${this.props.name}`;
  }
}

test("JsonTenantStore round-trips entities across instances", () => {
  const dir = mkdtempSync(join(tmpdir(), "suite-persist-"));
  try {
    const first = new JsonTenantStore<DemoEntity>({
      service: "test-svc",
      name: "entities",
      dir,
      enabled: true,
      revive: (raw) => reviveEntity(DemoEntity.prototype, raw),
    });
    first.set("demo", "e1", new DemoEntity("demo", "e1", "Acme"));
    first.flush();

    const second = new JsonTenantStore<DemoEntity>({
      service: "test-svc",
      name: "entities",
      dir,
      enabled: true,
      revive: (raw) => reviveEntity(DemoEntity.prototype, raw),
    });
    assert.equal(second.isEmpty(), false);
    const loaded = second.get("demo", "e1");
    assert.ok(loaded);
    assert.equal(loaded.greet(), "hi Acme");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
