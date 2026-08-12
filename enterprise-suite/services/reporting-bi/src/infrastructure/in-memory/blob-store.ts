/**
 * In-memory artifact store for export files. Keys are namespaced by tenant
 * so a key collision across tenants is impossible, mirroring the prefixing
 * an object-store implementation would use.
 */
import type { IsoDateTime, TenantId } from "@enterprise-suite/shared-kernel";
import type { BlobStore, Clock, StoredArtifact } from "../../application/ports.js";
import { byteLengthOf, checksumOf } from "../../domain/csv.js";

export class InMemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredArtifact>();

  constructor(private readonly clock: Clock) {}

  async put(input: {
    tenantId: TenantId;
    key: string;
    content: string;
    contentType: string;
    expiresAt?: IsoDateTime;
  }): Promise<StoredArtifact> {
    const artifact: StoredArtifact = {
      key: input.key,
      contentType: input.contentType,
      content: input.content,
      byteSize: byteLengthOf(input.content),
      checksum: checksumOf(input.content),
      storedAt: this.clock.now(),
      expiresAt: input.expiresAt,
    };
    this.objects.set(this.scoped(input.tenantId, input.key), artifact);
    return artifact;
  }

  async get(tenantId: TenantId, key: string): Promise<StoredArtifact | null> {
    return this.objects.get(this.scoped(tenantId, key)) ?? null;
  }

  async delete(tenantId: TenantId, key: string): Promise<boolean> {
    return this.objects.delete(this.scoped(tenantId, key));
  }

  /** Removes expired artifacts; returns how many were reclaimed. */
  async evictExpired(): Promise<number> {
    const now = this.clock.now();
    let removed = 0;
    for (const [key, artifact] of this.objects) {
      if (artifact.expiresAt && artifact.expiresAt <= now) {
        this.objects.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.objects.size;
  }

  private scoped(tenantId: TenantId, key: string): string {
    return `${tenantId}/${key}`;
  }
}
