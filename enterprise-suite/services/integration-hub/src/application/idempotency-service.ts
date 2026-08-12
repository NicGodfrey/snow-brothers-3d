/**
 * Idempotency-key use-cases.
 *
 * `execute()` is the interesting one: it wraps an operation so that the
 * combination of (tenant, scope, key) runs at most once, and later retries of
 * the same request replay the stored response.
 */
import {
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  IdempotencyRecord,
  type StoredResponse,
} from "../domain/idempotency.js";
import type { IdempotencyRepository } from "../domain/repositories.js";
import type { Clock, EventPublisher } from "./ports.js";

export interface ExecuteResult<T> {
  readonly response: StoredResponse;
  readonly replayed: boolean;
  readonly value?: T;
}

export class IdempotencyService {
  constructor(
    private readonly records: IdempotencyRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly defaultTtlMs?: number,
  ) {}

  /**
   * Reserves a key, or resolves the repeat: returns `{ replayed: true }` with
   * the original response, throws `IdempotencyInProgressError` (409) while the
   * first attempt is still running, and `IdempotencyKeyReuseError` (422) when
   * the same key arrives with a different body.
   */
  async begin(
    ctx: TenantContext,
    input: { key: string; scope: string; request: unknown; ttlMs?: number },
  ): Promise<{ record: IdempotencyRecord; replay?: StoredResponse }> {
    const now = this.clock.now();
    const existing = await this.records.findByKey(ctx.tenantId, input.scope, input.key);
    if (existing) {
      if (existing.isExpired(now) || existing.status === "failed") {
        existing.reopen(input.request, now, input.ttlMs ?? this.defaultTtlMs);
        await this.flush(existing);
        return { record: existing };
      }
      try {
        const replay = existing.serveReplay(input.request);
        return { record: existing, replay };
      } finally {
        await this.flush(existing);
      }
    }

    const record = IdempotencyRecord.reserve({
      tenantId: ctx.tenantId,
      key: input.key,
      scope: input.scope,
      request: input.request,
      now,
      ttlMs: input.ttlMs ?? this.defaultTtlMs,
    });
    await this.flush(record);
    return { record };
  }

  async complete(
    ctx: TenantContext,
    input: { key: string; scope: string; response: StoredResponse },
  ): Promise<IdempotencyRecord> {
    const record = await this.require(ctx, input.scope, input.key);
    record.complete(input.response, this.clock.now());
    await this.flush(record);
    return record;
  }

  async fail(
    ctx: TenantContext,
    input: { key: string; scope: string; error: string },
  ): Promise<IdempotencyRecord> {
    const record = await this.require(ctx, input.scope, input.key);
    record.fail(input.error, this.clock.now());
    await this.flush(record);
    return record;
  }

  /**
   * Runs `operation` at most once per key. A failure releases the key so the
   * caller can retry; a success stores the response for replay.
   */
  async execute<T>(
    ctx: TenantContext,
    input: { key: string; scope: string; request: unknown; ttlMs?: number },
    operation: () => Promise<{ status: number; body: T }>,
  ): Promise<ExecuteResult<T>> {
    const { record, replay } = await this.begin(ctx, input);
    if (replay) return { response: replay, replayed: true };

    try {
      const result = await operation();
      record.complete({ status: result.status, body: result.body }, this.clock.now());
      await this.flush(record);
      return { response: { status: result.status, body: result.body }, replayed: false, value: result.body };
    } catch (error) {
      record.fail(error instanceof Error ? error.message : String(error), this.clock.now());
      await this.flush(record);
      throw error;
    }
  }

  async get(ctx: TenantContext, scope: string, key: string): Promise<IdempotencyRecord> {
    return this.require(ctx, scope, key);
  }

  async findById(ctx: TenantContext, id: Ulid): Promise<IdempotencyRecord> {
    const record = await this.records.findById(ctx.tenantId, id);
    if (!record) throw new NotFoundError("IdempotencyRecord", id);
    return record;
  }

  async list(ctx: TenantContext, filter?: { scope?: string }): Promise<IdempotencyRecord[]> {
    return this.records.list(ctx.tenantId, filter);
  }

  /** Housekeeping job: drops records past their TTL. */
  async purgeExpired(ctx?: TenantContext): Promise<number> {
    return this.records.purgeExpired(this.clock.now(), ctx?.tenantId);
  }

  private async require(ctx: TenantContext, scope: string, key: string): Promise<IdempotencyRecord> {
    const record = await this.records.findByKey(ctx.tenantId, scope, key);
    if (!record) throw new NotFoundError("IdempotencyRecord", `${scope}:${key}`);
    return record;
  }

  private async flush(record: IdempotencyRecord): Promise<void> {
    await this.records.save(record);
    await this.publisher.publishAll(record.pullEvents());
  }
}
