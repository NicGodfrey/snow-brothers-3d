/**
 * Outbox use-cases: ingestion from domain services, worker claiming, and the
 * operator surface (inspect, dead-letter, replay).
 */
import {
  NotFoundError,
  type EventEnvelope,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { NETWORK_RETRY_POLICY, type RetryPolicy } from "@enterprise-suite/event-bus";
import { OutboxMessage, type OutboxStatus } from "../domain/outbox.js";
import type { OutboxRepository, StatusCounts } from "../domain/repositories.js";
import type { Clock, EventPublisher, WorkerIdentity } from "./ports.js";

export interface EnqueueResult {
  readonly message: OutboxMessage;
  /** True when the event had already been ingested and was ignored. */
  readonly duplicate: boolean;
}

export class OutboxService {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly retry: RetryPolicy = NETWORK_RETRY_POLICY,
  ) {}

  /**
   * Ingests one event from a domain service. Idempotent on
   * `(tenant, source, eventId)` so a service that re-drains its local outbox
   * after a crash cannot double-publish.
   */
  async enqueue(
    ctx: TenantContext,
    input: { source: string; event: EventEnvelope; maxAttempts?: number; partitionKey?: string },
  ): Promise<EnqueueResult> {
    const existing = await this.outbox.findByEventId(
      ctx.tenantId,
      input.source,
      String(input.event.eventId),
    );
    if (existing) return { message: existing, duplicate: true };

    const message = OutboxMessage.enqueue({
      tenantId: ctx.tenantId,
      source: input.source,
      event: input.event,
      now: this.clock.now(),
      maxAttempts: input.maxAttempts,
      partitionKey: input.partitionKey,
    });
    await this.flush(message);
    return { message, duplicate: false };
  }

  /** Bulk ingestion — what a service's `POST /outbox/drain` relay call sends. */
  async enqueueBatch(
    ctx: TenantContext,
    input: { source: string; events: readonly EventEnvelope[] },
  ): Promise<{ enqueued: number; duplicates: number; messages: OutboxMessage[] }> {
    let enqueued = 0;
    let duplicates = 0;
    const messages: OutboxMessage[] = [];
    for (const event of input.events) {
      const result = await this.enqueue(ctx, { source: input.source, event });
      messages.push(result.message);
      if (result.duplicate) duplicates++;
      else enqueued++;
    }
    return { enqueued, duplicates, messages };
  }

  /**
   * Claims up to `limit` due messages for a worker. Claims are leased, so a
   * worker that dies releases its messages when the lease expires.
   */
  async claim(
    worker: WorkerIdentity,
    limit: number,
    filter?: { tenantId?: TenantId; source?: string },
  ): Promise<OutboxMessage[]> {
    const now = this.clock.now();
    const candidates = await this.outbox.listClaimable(now, limit, filter);
    const claimed: OutboxMessage[] = [];
    for (const message of candidates) {
      message.claim(worker.name, now, worker.leaseMs);
      await this.outbox.save(message);
      claimed.push(message);
    }
    return claimed;
  }

  async markPublished(worker: WorkerIdentity, message: OutboxMessage): Promise<void> {
    message.markPublished(worker.name, this.clock.now());
    await this.flush(message);
  }

  async markFailed(worker: WorkerIdentity, message: OutboxMessage, error: string): Promise<void> {
    message.markFailed({
      owner: worker.name,
      error,
      now: this.clock.now(),
      policy: this.retry,
    });
    await this.flush(message);
  }

  async release(worker: WorkerIdentity, message: OutboxMessage): Promise<void> {
    message.releaseLease(worker.name);
    await this.outbox.save(message);
  }

  async get(ctx: TenantContext, id: Ulid): Promise<OutboxMessage> {
    const message = await this.outbox.findById(ctx.tenantId, id);
    if (!message) throw new NotFoundError("OutboxMessage", id);
    return message;
  }

  async list(
    ctx: TenantContext,
    filter?: { status?: OutboxStatus; source?: string; eventType?: string },
  ): Promise<OutboxMessage[]> {
    return this.outbox.list(ctx.tenantId, filter);
  }

  async deadLetter(ctx: TenantContext, id: Ulid, reason: string): Promise<OutboxMessage> {
    const message = await this.get(ctx, id);
    message.deadLetter(reason, this.clock.now());
    await this.flush(message);
    return message;
  }

  async replay(ctx: TenantContext, id: Ulid, extraAttempts?: number): Promise<OutboxMessage> {
    const message = await this.get(ctx, id);
    message.replay(this.clock.now(), extraAttempts);
    await this.flush(message);
    return message;
  }

  /** Bulk replay of every dead-lettered message, optionally per source. */
  async replayDeadLetters(ctx: TenantContext, filter?: { source?: string }): Promise<number> {
    const messages = await this.outbox.list(ctx.tenantId, {
      status: "dead-lettered",
      source: filter?.source,
    });
    for (const message of messages) {
      message.replay(this.clock.now());
      await this.flush(message);
    }
    return messages.length;
  }

  async stats(ctx: TenantContext): Promise<StatusCounts> {
    return this.outbox.countsByStatus(ctx.tenantId);
  }

  private async flush(message: OutboxMessage): Promise<void> {
    await this.outbox.save(message);
    await this.publisher.publishAll(message.pullEvents());
  }
}
