/**
 * Outbox message aggregate.
 *
 * Domain services write events into their own transactional outbox alongside
 * the aggregate change. The hub takes ownership of the *relay* half of the
 * pattern: a message is enqueued here, claimed by a worker under a lease,
 * published to the bus, and either acknowledged or retried with backoff.
 *
 * Lifecycle:
 *   pending ──claim──> in-flight ──published──> published
 *      ^                   │
 *      └─── failed (retry budget left, availableAt = now + backoff)
 *                          │
 *                          └──> dead-lettered (budget exhausted / poison)
 *   failed | dead-lettered ──replay──> pending
 *
 * A lease makes concurrent relay workers safe: only the lease owner may
 * acknowledge, and an expired lease is reclaimable so a crashed worker does
 * not strand messages.
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type EventEnvelope,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { nextDelayMs, shouldRetry, type RetryPolicy } from "@enterprise-suite/event-bus";
import { IntegrationEventTypes, type OutboxMessageEnqueuedPayload } from "./events.js";
import { addMs, atOrBefore, durationMs } from "./time.js";

export type OutboxStatus = "pending" | "in-flight" | "published" | "dead-lettered";

export interface OutboxLease {
  readonly owner: string;
  readonly acquiredAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export interface OutboxFailure {
  readonly message: string;
  readonly attempt: number;
  readonly at: IsoDateTime;
}

interface OutboxMessageProps {
  source: string;
  event: EventEnvelope;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  /** Not claimable before this instant; moved forward by backoff. */
  availableAt: IsoDateTime;
  /** Ordering hint — messages of one aggregate must be relayed in order. */
  partitionKey: string;
  enqueuedAt: IsoDateTime;
  lease?: OutboxLease;
  lastFailure?: OutboxFailure;
  publishedAt?: IsoDateTime;
  deadLetterReason?: string;
  replayCount: number;
}

export const DEFAULT_LEASE_MS = 30_000;

export class OutboxMessage extends AggregateRoot<OutboxMessageProps> {
  private constructor(tenantId: TenantId, props: OutboxMessageProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static enqueue(input: {
    tenantId: TenantId;
    source: string;
    event: EventEnvelope;
    now: IsoDateTime;
    maxAttempts?: number;
    partitionKey?: string;
  }): OutboxMessage {
    if (!input.source.trim()) throw new DomainError("source is required", "VALIDATION");
    if (!input.event?.eventId || !input.event.eventType) {
      throw new DomainError("event must be a shared-kernel EventEnvelope", "VALIDATION");
    }
    if (input.event.tenantId !== input.tenantId) {
      throw new DomainError("event.tenantId must match the enqueueing tenant", "VALIDATION");
    }
    const message = new OutboxMessage(input.tenantId, {
      source: input.source.trim(),
      event: input.event,
      status: "pending",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 8,
      availableAt: input.now,
      partitionKey: input.partitionKey ?? String(input.event.aggregateId),
      enqueuedAt: input.now,
      replayCount: 0,
    });
    const payload: OutboxMessageEnqueuedPayload = {
      source: message.props.source,
      eventId: String(input.event.eventId),
      eventType: input.event.eventType,
      partitionKey: message.props.partitionKey,
    };
    message.raise(
      envelope({
        eventType: IntegrationEventTypes.OutboxMessageEnqueued,
        aggregateType: "OutboxMessage",
        aggregateId: message.id,
        tenantId: input.tenantId,
        payload,
        correlationId: input.event.correlationId,
        causationId: input.event.eventId,
      }),
    );
    return message;
  }

  static rehydrate(
    tenantId: TenantId,
    props: OutboxMessageProps,
    existing: Partial<EntityProps>,
  ): OutboxMessage {
    return new OutboxMessage(tenantId, props, existing);
  }

  get source(): string { return this.props.source; }
  get event(): EventEnvelope { return this.props.event; }
  get eventType(): string { return this.props.event.eventType; }
  get eventId(): string { return String(this.props.event.eventId); }
  get status(): OutboxStatus { return this.props.status; }
  get attempts(): number { return this.props.attempts; }
  get maxAttempts(): number { return this.props.maxAttempts; }
  get availableAt(): IsoDateTime { return this.props.availableAt; }
  get partitionKey(): string { return this.props.partitionKey; }
  get lease(): OutboxLease | undefined { return this.props.lease; }
  get lastFailure(): OutboxFailure | undefined { return this.props.lastFailure; }
  get publishedAt(): IsoDateTime | undefined { return this.props.publishedAt; }
  get deadLetterReason(): string | undefined { return this.props.deadLetterReason; }
  get replayCount(): number { return this.props.replayCount; }

  /** Pending, past its backoff, and not held by a live lease. */
  isClaimable(now: IsoDateTime): boolean {
    if (this.props.status === "published" || this.props.status === "dead-lettered") return false;
    if (!atOrBefore(this.props.availableAt, now)) return false;
    if (this.props.status === "in-flight") {
      return this.props.lease !== undefined && atOrBefore(this.props.lease.expiresAt, now);
    }
    return true;
  }

  claim(owner: string, now: IsoDateTime, leaseMs = DEFAULT_LEASE_MS): void {
    if (!owner.trim()) throw new DomainError("lease owner is required", "VALIDATION");
    if (!this.isClaimable(now)) {
      throw new ConflictError(
        `Outbox message ${this.id} is not claimable (status=${this.props.status}, availableAt=${this.props.availableAt})`,
      );
    }
    const reclaimed = this.props.status === "in-flight";
    this.props.status = "in-flight";
    this.props.lease = { owner, acquiredAt: now, expiresAt: addMs(now, leaseMs) };
    if (reclaimed) {
      // A crashed worker may have published already; the consumer side is
      // idempotent, so re-delivery is preferred over losing the message.
      this.props.lastFailure = {
        message: "lease expired, message reclaimed",
        attempt: this.props.attempts,
        at: now,
      };
    }
    this.touch();
  }

  private assertOwner(owner: string): void {
    if (this.props.lease && this.props.lease.owner !== owner) {
      throw new ConflictError(
        `Outbox message ${this.id} is leased by '${this.props.lease.owner}', not '${owner}'`,
      );
    }
  }

  markPublished(owner: string, now: IsoDateTime): void {
    if (this.props.status !== "in-flight") {
      throw new ConflictError(`Only in-flight messages can be acknowledged (status=${this.props.status})`);
    }
    this.assertOwner(owner);
    this.props.attempts += 1;
    this.props.status = "published";
    this.props.publishedAt = now;
    this.props.lease = undefined;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.OutboxMessagePublished,
        aggregateType: "OutboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          eventId: this.eventId,
          eventType: this.eventType,
          attempts: this.props.attempts,
          latencyMs: durationMs(this.props.enqueuedAt, now),
        },
      }),
    );
  }

  /**
   * Records a failed publish. Reschedules with backoff while the retry budget
   * lasts, otherwise dead-letters the message.
   */
  markFailed(input: { owner: string; error: string; now: IsoDateTime; policy: RetryPolicy }): void {
    if (this.props.status !== "in-flight") {
      throw new ConflictError(`Only in-flight messages can fail (status=${this.props.status})`);
    }
    this.assertOwner(input.owner);
    this.props.attempts += 1;
    this.props.lease = undefined;
    this.props.lastFailure = { message: input.error, attempt: this.props.attempts, at: input.now };

    const budget = Math.min(this.props.maxAttempts, input.policy.maxAttempts);
    const canRetry = shouldRetry({ ...input.policy, maxAttempts: budget }, this.props.attempts);
    if (!canRetry) {
      this.props.status = "dead-lettered";
      this.props.deadLetterReason = `retry budget exhausted after ${this.props.attempts} attempts: ${input.error}`;
      this.raise(
        envelope({
          eventType: IntegrationEventTypes.OutboxMessageDeadLettered,
          aggregateType: "OutboxMessage",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            source: this.props.source,
            eventId: this.eventId,
            eventType: this.eventType,
            attempts: this.props.attempts,
            error: input.error,
          },
        }),
      );
      return;
    }

    this.props.status = "pending";
    this.props.availableAt = addMs(input.now, nextDelayMs(input.policy, this.props.attempts));
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.OutboxMessageFailed,
        aggregateType: "OutboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          eventId: this.eventId,
          eventType: this.eventType,
          attempts: this.props.attempts,
          error: input.error,
          nextAttemptAt: this.props.availableAt,
        },
      }),
    );
  }

  /** Gives the message back without consuming an attempt (graceful shutdown). */
  releaseLease(owner: string): void {
    if (this.props.status !== "in-flight") return;
    this.assertOwner(owner);
    this.props.status = "pending";
    this.props.lease = undefined;
    this.touch();
  }

  /** Operator action: hard-stop a poison message. */
  deadLetter(reason: string, now: IsoDateTime): void {
    if (this.props.status === "published") {
      throw new ConflictError("Published messages cannot be dead-lettered");
    }
    if (!reason.trim()) throw new DomainError("reason is required", "VALIDATION");
    this.props.status = "dead-lettered";
    this.props.lease = undefined;
    this.props.deadLetterReason = reason.trim();
    this.props.lastFailure = { message: reason.trim(), attempt: this.props.attempts, at: now };
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.OutboxMessageDeadLettered,
        aggregateType: "OutboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          eventId: this.eventId,
          eventType: this.eventType,
          attempts: this.props.attempts,
          error: reason.trim(),
        },
      }),
    );
  }

  /** Operator action: put a dead-lettered message back in the queue. */
  replay(now: IsoDateTime, extraAttempts = 3): void {
    if (this.props.status !== "dead-lettered") {
      throw new ConflictError(`Only dead-lettered messages can be replayed (status=${this.props.status})`);
    }
    this.props.status = "pending";
    this.props.availableAt = now;
    this.props.deadLetterReason = undefined;
    this.props.maxAttempts = this.props.attempts + Math.max(1, extraAttempts);
    this.props.replayCount += 1;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.OutboxMessageReplayed,
        aggregateType: "OutboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          eventId: this.eventId,
          eventType: this.eventType,
          replayCount: this.props.replayCount,
          maxAttempts: this.props.maxAttempts,
        },
      }),
    );
  }
}
