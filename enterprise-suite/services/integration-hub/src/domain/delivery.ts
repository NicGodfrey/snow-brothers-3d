/**
 * Webhook delivery aggregate — one event heading to one subscription.
 *
 * The endpoint, headers and rendered body are snapshotted when the delivery
 * is scheduled: editing a subscription afterwards must not silently change
 * what an already-queued delivery sends, and the attempt history has to stay
 * explainable months later.
 *
 * Lifecycle:
 *   pending ──begin──> in-flight ──2xx──> delivered
 *      ^                   │
 *      │                   ├── retryable failure ──> pending (backoff)
 *      └───────────────────┘
 *                          └── permanent failure ──> dead-lettered
 *   pending | in-flight ──cancel──> cancelled
 *
 * Retryable: network errors, timeouts, HTTP 408/429 and any 5xx. Everything
 * else (400, 401, 403, 404, 422, ...) is a receiver-side contract problem
 * that retrying cannot fix, so the delivery is dead-lettered immediately.
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { nextDelayMs, shouldRetry, type RetryPolicy } from "@enterprise-suite/event-bus";
import { IntegrationEventTypes, type WebhookDeliveryOutcomePayload } from "./events.js";
import { addMs, atOrBefore } from "./time.js";

export type DeliveryStatus =
  | "pending"
  | "in-flight"
  | "delivered"
  | "dead-lettered"
  | "cancelled";

export type AttemptOutcome =
  | "success"
  | "http-error"
  | "network-error"
  | "timeout"
  | "invalid-response";

export interface DeliveryAttempt {
  readonly attemptNumber: number;
  readonly startedAt: IsoDateTime;
  readonly durationMs: number;
  readonly outcome: AttemptOutcome;
  readonly statusCode?: number;
  readonly responseSnippet?: string;
  readonly error?: string;
}

interface WebhookDeliveryProps {
  subscriptionId: Ulid;
  eventId: string;
  eventType: string;
  /** Snapshot of the target at scheduling time. */
  endpointUrl: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  maxAttempts: number;
  scheduledAt: IsoDateTime;
  availableAt: IsoDateTime;
  startedAt?: IsoDateTime;
  deliveredAt?: IsoDateTime;
  failureReason?: string;
  cancelReason?: string;
}

const RESPONSE_SNIPPET_LIMIT = 512;

/** HTTP statuses worth retrying: throttling, request timeout and server errors. */
export function isRetryableStatus(statusCode: number): boolean {
  if (statusCode === 408 || statusCode === 429) return true;
  return statusCode >= 500 && statusCode <= 599;
}

export function isRetryableOutcome(outcome: AttemptOutcome, statusCode?: number): boolean {
  switch (outcome) {
    case "success":
      return false;
    case "network-error":
    case "timeout":
      return true;
    case "invalid-response":
      return false;
    case "http-error":
      return statusCode !== undefined && isRetryableStatus(statusCode);
  }
}

export class WebhookDelivery extends AggregateRoot<WebhookDeliveryProps> {
  private constructor(
    tenantId: TenantId,
    props: WebhookDeliveryProps,
    existing?: Partial<EntityProps>,
  ) {
    super(tenantId, props, existing);
  }

  static schedule(input: {
    tenantId: TenantId;
    subscriptionId: Ulid;
    eventId: string;
    eventType: string;
    endpointUrl: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    maxAttempts: number;
    now: IsoDateTime;
    delayMs?: number;
  }): WebhookDelivery {
    if (!input.body) throw new DomainError("delivery body is required", "VALIDATION");
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new DomainError("maxAttempts must be a positive integer", "VALIDATION");
    }
    const delivery = new WebhookDelivery(input.tenantId, {
      subscriptionId: input.subscriptionId,
      eventId: input.eventId,
      eventType: input.eventType,
      endpointUrl: input.endpointUrl,
      headers: input.headers,
      body: input.body,
      timeoutMs: input.timeoutMs,
      status: "pending",
      attempts: [],
      maxAttempts: input.maxAttempts,
      scheduledAt: input.now,
      availableAt: input.delayMs ? addMs(input.now, input.delayMs) : input.now,
    });
    delivery.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookDeliveryScheduled,
        aggregateType: "WebhookDelivery",
        aggregateId: delivery.id,
        tenantId: input.tenantId,
        payload: {
          subscriptionId: input.subscriptionId,
          eventId: input.eventId,
          eventType: input.eventType,
          endpointUrl: input.endpointUrl,
        },
      }),
    );
    return delivery;
  }

  static rehydrate(
    tenantId: TenantId,
    props: WebhookDeliveryProps,
    existing: Partial<EntityProps>,
  ): WebhookDelivery {
    return new WebhookDelivery(tenantId, props, existing);
  }

  get subscriptionId(): Ulid { return this.props.subscriptionId; }
  get eventId(): string { return this.props.eventId; }
  get eventType(): string { return this.props.eventType; }
  get endpointUrl(): string { return this.props.endpointUrl; }
  get headers(): Readonly<Record<string, string>> { return this.props.headers; }
  get body(): string { return this.props.body; }
  get timeoutMs(): number { return this.props.timeoutMs; }
  get status(): DeliveryStatus { return this.props.status; }
  get attempts(): readonly DeliveryAttempt[] { return this.props.attempts; }
  get attemptCount(): number { return this.props.attempts.length; }
  get maxAttempts(): number { return this.props.maxAttempts; }
  get availableAt(): IsoDateTime { return this.props.availableAt; }
  get deliveredAt(): IsoDateTime | undefined { return this.props.deliveredAt; }
  get failureReason(): string | undefined { return this.props.failureReason; }
  get lastAttempt(): DeliveryAttempt | undefined {
    return this.props.attempts[this.props.attempts.length - 1];
  }

  isDue(now: IsoDateTime): boolean {
    return this.props.status === "pending" && atOrBefore(this.props.availableAt, now);
  }

  /** Marks the delivery in-flight and returns the attempt number about to run. */
  beginAttempt(now: IsoDateTime): number {
    if (this.props.status !== "pending") {
      throw new ConflictError(`Only pending deliveries can be attempted (status=${this.props.status})`);
    }
    if (!atOrBefore(this.props.availableAt, now)) {
      throw new ConflictError(`Delivery is backing off until ${this.props.availableAt}`);
    }
    this.props.status = "in-flight";
    this.props.startedAt = now;
    this.touch();
    return this.props.attempts.length + 1;
  }

  recordSuccess(input: {
    statusCode: number;
    durationMs: number;
    now: IsoDateTime;
    responseSnippet?: string;
  }): DeliveryAttempt {
    if (this.props.status !== "in-flight") {
      throw new ConflictError(`Only in-flight deliveries can succeed (status=${this.props.status})`);
    }
    const attempt = this.pushAttempt({
      outcome: "success",
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      responseSnippet: input.responseSnippet,
    });
    this.props.status = "delivered";
    this.props.deliveredAt = input.now;
    const payload: WebhookDeliveryOutcomePayload = {
      subscriptionId: this.props.subscriptionId,
      deliveryId: this.id,
      eventType: this.props.eventType,
      attempts: this.props.attempts.length,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
    };
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookDeliverySucceeded,
        aggregateType: "WebhookDelivery",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
    return attempt;
  }

  /**
   * Records a failed attempt and decides what happens next.
   * `retryAfterMs` honours a receiver's `Retry-After`, capped by the policy.
   */
  recordFailure(input: {
    outcome: Exclude<AttemptOutcome, "success">;
    error: string;
    durationMs: number;
    now: IsoDateTime;
    policy: RetryPolicy;
    statusCode?: number;
    responseSnippet?: string;
    retryAfterMs?: number;
  }): { retrying: boolean; nextAttemptAt?: IsoDateTime } {
    if (this.props.status !== "in-flight") {
      throw new ConflictError(`Only in-flight deliveries can fail (status=${this.props.status})`);
    }
    this.pushAttempt({
      outcome: input.outcome,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      responseSnippet: input.responseSnippet,
      error: input.error,
    });

    const attemptNumber = this.props.attempts.length;
    const budget = Math.min(this.props.maxAttempts, input.policy.maxAttempts);
    const retryable = isRetryableOutcome(input.outcome, input.statusCode);
    const hasBudget = shouldRetry({ ...input.policy, maxAttempts: budget }, attemptNumber);

    if (retryable && hasBudget) {
      const backoff = nextDelayMs(input.policy, attemptNumber);
      const delay =
        input.retryAfterMs !== undefined
          ? Math.min(Math.max(input.retryAfterMs, backoff), input.policy.maxDelayMs)
          : backoff;
      this.props.status = "pending";
      this.props.availableAt = addMs(input.now, delay);
      this.raise(
        envelope({
          eventType: IntegrationEventTypes.WebhookDeliveryRetryScheduled,
          aggregateType: "WebhookDelivery",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            subscriptionId: this.props.subscriptionId,
            deliveryId: this.id,
            eventType: this.props.eventType,
            attempts: attemptNumber,
            statusCode: input.statusCode,
            error: input.error,
            nextAttemptAt: this.props.availableAt,
          } satisfies WebhookDeliveryOutcomePayload,
        }),
      );
      return { retrying: true, nextAttemptAt: this.props.availableAt };
    }

    this.props.status = "dead-lettered";
    this.props.failureReason = retryable
      ? `retry budget exhausted after ${attemptNumber} attempts: ${input.error}`
      : `permanent failure: ${input.error}`;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookDeliveryDeadLettered,
        aggregateType: "WebhookDelivery",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          subscriptionId: this.props.subscriptionId,
          deliveryId: this.id,
          eventType: this.props.eventType,
          attempts: attemptNumber,
          statusCode: input.statusCode,
          error: this.props.failureReason,
        } satisfies WebhookDeliveryOutcomePayload,
      }),
    );
    return { retrying: false };
  }

  cancel(reason: string, now: IsoDateTime): void {
    if (this.props.status === "delivered") {
      throw new ConflictError("Delivered deliveries cannot be cancelled");
    }
    if (this.props.status === "cancelled") return;
    if (!reason.trim()) throw new DomainError("reason is required", "VALIDATION");
    this.props.status = "cancelled";
    this.props.cancelReason = reason.trim();
    this.props.availableAt = now;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookDeliveryCancelled,
        aggregateType: "WebhookDelivery",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          subscriptionId: this.props.subscriptionId,
          deliveryId: this.id,
          eventType: this.props.eventType,
          attempts: this.props.attempts.length,
          error: reason.trim(),
        } satisfies WebhookDeliveryOutcomePayload,
      }),
    );
  }

  /** Operator action: queue a dead-lettered or cancelled delivery again. */
  requeue(now: IsoDateTime, extraAttempts = 3): void {
    if (this.props.status !== "dead-lettered" && this.props.status !== "cancelled") {
      throw new ConflictError(
        `Only dead-lettered or cancelled deliveries can be requeued (status=${this.props.status})`,
      );
    }
    this.props.status = "pending";
    this.props.availableAt = now;
    this.props.failureReason = undefined;
    this.props.cancelReason = undefined;
    this.props.maxAttempts = this.props.attempts.length + Math.max(1, extraAttempts);
    this.touch();
  }

  /** Refreshes the snapshot after a subscription edit (endpoint/secret change). */
  retarget(input: { endpointUrl: string; headers: Record<string, string>; body?: string }): void {
    if (this.props.status === "delivered") {
      throw new ConflictError("Delivered deliveries cannot be retargeted");
    }
    this.props.endpointUrl = input.endpointUrl;
    this.props.headers = input.headers;
    if (input.body !== undefined) this.props.body = input.body;
    this.touch();
  }

  private pushAttempt(input: {
    outcome: AttemptOutcome;
    durationMs: number;
    statusCode?: number;
    responseSnippet?: string;
    error?: string;
  }): DeliveryAttempt {
    const attempt: DeliveryAttempt = {
      attemptNumber: this.props.attempts.length + 1,
      startedAt: this.props.startedAt ?? this.props.availableAt,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      outcome: input.outcome,
      statusCode: input.statusCode,
      responseSnippet: input.responseSnippet?.slice(0, RESPONSE_SNIPPET_LIMIT),
      error: input.error,
    };
    this.props.attempts.push(attempt);
    return attempt;
  }
}
