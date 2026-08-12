/**
 * Application ports: outbox publishing, numbering, clock, artifact storage.
 */
import type { EventEnvelope, IsoDateTime, TenantId } from "@enterprise-suite/shared-kernel";

export interface Outbox {
  append(events: readonly EventEnvelope[]): Promise<void>;
  /** Returns and marks pending events as dispatched. */
  drain(): Promise<EventEnvelope[]>;
  pending(): Promise<readonly EventEnvelope[]>;
}

/** Tenant-scoped document numbering, e.g. EXP-2026-000042. */
export interface NumberSeries {
  next(tenantId: TenantId, seriesCode: string): Promise<string>;
}

export interface Clock {
  now(): IsoDateTime;
}

export interface StoredArtifact {
  readonly key: string;
  readonly contentType: string;
  readonly content: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly storedAt: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
}

/**
 * Where export artifacts live. In-memory here; the same three methods map
 * onto S3-style object storage without changing callers.
 */
export interface BlobStore {
  put(input: {
    tenantId: TenantId;
    key: string;
    content: string;
    contentType: string;
    expiresAt?: IsoDateTime;
  }): Promise<StoredArtifact>;
  get(tenantId: TenantId, key: string): Promise<StoredArtifact | null>;
  delete(tenantId: TenantId, key: string): Promise<boolean>;
}

export const documentSeries = {
  export: "EXP",
} as const;
