/**
 * Webhook delivery: fan-out, dispatching, retry bookkeeping.
 *
 * Two halves, deliberately separated so a slow endpoint never blocks the
 * relay:
 *   1. `scheduleForEvent` — synchronous, cheap: create one pending delivery
 *      per matching subscription.
 *   2. `dispatchDue` — the worker loop: pick due deliveries, sign and POST
 *      them, then record the outcome on both the delivery and the
 *      subscription's circuit breaker.
 */
import {
  ConflictError,
  NotFoundError,
  type EventEnvelope,
  type IsoDateTime,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { NETWORK_RETRY_POLICY, validateRetryPolicy, type RetryPolicy } from "@enterprise-suite/event-bus";
import { WebhookDelivery, type AttemptOutcome, type DeliveryStatus } from "../domain/delivery.js";
import type {
  DeliveryRepository,
  StatusCounts,
  WebhookSubscriptionRepository,
} from "../domain/repositories.js";
import { SIGNATURE_HEADER, signPayload } from "../domain/signature.js";
import { epochSeconds } from "../domain/time.js";
import type { WebhookSubscription } from "../domain/webhook.js";
import type {
  Clock,
  DispatchSummary,
  EventPublisher,
  HubLogger,
  WebhookRequest,
  WebhookTransport,
} from "./ports.js";

export const USER_AGENT = "enterprise-suite-integration-hub/0.1";

/** Wire format of a webhook body. Stable across event types by design. */
export interface WebhookPayload {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly schemaVersion: number;
  readonly correlationId?: string;
  readonly data: unknown;
}

export function renderWebhookBody(event: EventEnvelope, data?: unknown): string {
  const payload: WebhookPayload = {
    eventId: String(event.eventId),
    eventType: event.eventType,
    tenantId: String(event.tenantId),
    aggregateType: event.aggregateType,
    aggregateId: String(event.aggregateId),
    occurredAt: String(event.occurredAt),
    schemaVersion: event.schemaVersion,
    correlationId: event.correlationId ? String(event.correlationId) : undefined,
    data: data ?? event.payload,
  };
  return JSON.stringify(payload);
}

export class DeliveryService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly transport: WebhookTransport,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly defaultRetry: RetryPolicy = NETWORK_RETRY_POLICY,
    private readonly logger?: HubLogger,
  ) {}

  /** Effective policy for a subscription: defaults overridden per endpoint. */
  private policyFor(subscription: WebhookSubscription): RetryPolicy {
    const policy = { ...this.defaultRetry, ...(subscription.retryOverride ?? {}) };
    return validateRetryPolicy({ ...policy, maxAttempts: subscription.maxAttempts });
  }

  /**
   * Creates deliveries for every active subscription matching the event.
   * `extraSubscriptionIds` carries targets selected by an explicit route rule.
   */
  async scheduleForEvent(
    event: EventEnvelope,
    options: { extraSubscriptionIds?: readonly Ulid[]; payloadOverride?: unknown } = {},
  ): Promise<WebhookDelivery[]> {
    const tenantId = event.tenantId;
    const matching = await this.subscriptions.listMatching(tenantId, event.eventType);
    const byId = new Map(matching.map((subscription) => [String(subscription.id), subscription]));
    for (const id of options.extraSubscriptionIds ?? []) {
      if (byId.has(String(id))) continue;
      const subscription = await this.subscriptions.findById(tenantId, id);
      if (subscription?.isActive) byId.set(String(id), subscription);
    }

    const now = this.clock.now();
    const created: WebhookDelivery[] = [];
    for (const subscription of byId.values()) {
      const delivery = WebhookDelivery.schedule({
        tenantId,
        subscriptionId: subscription.id,
        eventId: String(event.eventId),
        eventType: event.eventType,
        endpointUrl: subscription.endpointUrl,
        headers: { ...subscription.headers },
        body: renderWebhookBody(event, options.payloadOverride),
        timeoutMs: subscription.timeoutMs,
        maxAttempts: subscription.maxAttempts,
        now,
      });
      await this.flush(delivery);
      created.push(delivery);
    }
    return created;
  }

  /** Worker loop: attempts every delivery whose backoff has elapsed. */
  async dispatchDue(
    limit = 50,
    filter?: { tenantId?: TenantId; subscriptionId?: Ulid },
  ): Promise<DispatchSummary> {
    const now = this.clock.now();
    const due = await this.deliveries.listDue(now, limit, filter);
    let delivered = 0;
    let retrying = 0;
    let deadLettered = 0;
    let attempted = 0;

    for (const delivery of due) {
      const subscription = await this.subscriptions.findById(delivery.tenantId, delivery.subscriptionId);
      if (!subscription) {
        delivery.cancel("subscription no longer exists", this.clock.now());
        await this.flush(delivery);
        continue;
      }
      if (subscription.status === "disabled") {
        delivery.cancel(`subscription disabled: ${subscription.disabledReason ?? "unknown"}`, this.clock.now());
        await this.flush(delivery);
        continue;
      }
      // Paused endpoints keep their queue: leave the delivery pending.
      if (subscription.status === "paused") continue;

      attempted++;
      const outcome = await this.attempt(delivery, subscription);
      if (outcome === "delivered") delivered++;
      else if (outcome === "retrying") retrying++;
      else deadLettered++;
    }
    return { attempted, delivered, retrying, deadLettered };
  }

  /** Signs, sends and records one attempt. */
  async attempt(
    delivery: WebhookDelivery,
    subscription: WebhookSubscription,
  ): Promise<"delivered" | "retrying" | "dead-lettered"> {
    const startedAt = this.clock.now();
    const attemptNumber = delivery.beginAttempt(startedAt);
    const request = this.buildRequest(delivery, subscription, attemptNumber, startedAt);

    const result = await this.transport.send(request);
    const policy = this.policyFor(subscription);
    const now = this.clock.now();

    if (result.kind === "response" && result.response.statusCode >= 200 && result.response.statusCode < 300) {
      delivery.recordSuccess({
        statusCode: result.response.statusCode,
        durationMs: result.durationMs,
        now,
        responseSnippet: result.response.body,
      });
      subscription.recordDeliverySuccess(now);
      await this.flush(delivery);
      await this.flushSubscription(subscription);
      return "delivered";
    }

    const failure =
      result.kind === "response"
        ? {
            outcome: "http-error" as const,
            error: `endpoint responded ${result.response.statusCode}`,
            statusCode: result.response.statusCode,
            responseSnippet: result.response.body,
            retryAfterMs: parseRetryAfter(result.response.headers["retry-after"]),
          }
        : {
            outcome: result.kind satisfies Exclude<AttemptOutcome, "success" | "http-error" | "invalid-response">,
            error: result.error,
            statusCode: undefined,
            responseSnippet: undefined,
            retryAfterMs: undefined,
          };

    const decision = delivery.recordFailure({
      outcome: failure.outcome,
      error: failure.error,
      statusCode: failure.statusCode,
      responseSnippet: failure.responseSnippet,
      retryAfterMs: failure.retryAfterMs,
      durationMs: result.durationMs,
      now,
      policy,
    });
    await this.flush(delivery);

    if (decision.retrying) {
      this.logger?.warn("webhook delivery retrying", {
        deliveryId: delivery.id,
        subscription: subscription.name,
        attempt: attemptNumber,
        nextAttemptAt: decision.nextAttemptAt,
        error: failure.error,
      });
      return "retrying";
    }

    const { autoDisabled } = subscription.recordDeliveryFailure(now);
    await this.flushSubscription(subscription);
    this.logger?.error("webhook delivery dead-lettered", {
      deliveryId: delivery.id,
      subscription: subscription.name,
      attempts: delivery.attemptCount,
      autoDisabled,
    });
    return "dead-lettered";
  }

  private buildRequest(
    delivery: WebhookDelivery,
    subscription: WebhookSubscription,
    attemptNumber: number,
    now: IsoDateTime,
  ): WebhookRequest {
    const timestamp = epochSeconds(now);
    return {
      url: delivery.endpointUrl,
      method: "POST",
      headers: {
        ...delivery.headers,
        "content-type": "application/json; charset=utf-8",
        "user-agent": USER_AGENT,
        "x-es-event-id": delivery.eventId,
        "x-es-event-type": delivery.eventType,
        "x-es-tenant-id": String(delivery.tenantId),
        "x-es-delivery-id": String(delivery.id),
        "x-es-attempt": String(attemptNumber),
        // Signed with the *current* secret so rotation takes effect on the
        // next attempt, while the receiver's grace window still accepts it.
        [SIGNATURE_HEADER]: signPayload(subscription.secret, delivery.body, timestamp),
      },
      body: delivery.body,
      timeoutMs: delivery.timeoutMs,
    };
  }

  /** Sends a synthetic ping so an operator can validate a new endpoint. */
  async ping(
    ctx: TenantContext,
    subscriptionId: Ulid,
  ): Promise<{ delivery: WebhookDelivery; outcome: string }> {
    const subscription = await this.subscriptions.findById(ctx.tenantId, subscriptionId);
    if (!subscription) throw new NotFoundError("WebhookSubscription", subscriptionId);
    if (subscription.status === "disabled") {
      throw new ConflictError("Enable the subscription before sending a test ping");
    }
    const now = this.clock.now();
    const body = JSON.stringify({
      eventId: `ping_${String(subscriptionId)}`,
      eventType: "integration.webhook.ping",
      tenantId: String(ctx.tenantId),
      occurredAt: now,
      schemaVersion: 1,
      data: { subscription: subscription.name, requestedBy: String(ctx.userId) },
    });
    const delivery = WebhookDelivery.schedule({
      tenantId: ctx.tenantId,
      subscriptionId: subscription.id,
      eventId: `ping_${String(subscriptionId)}`,
      eventType: "integration.webhook.ping",
      endpointUrl: subscription.endpointUrl,
      headers: { ...subscription.headers },
      body,
      timeoutMs: subscription.timeoutMs,
      maxAttempts: 1,
      now,
    });
    await this.flush(delivery);
    const outcome = await this.attempt(delivery, subscription);
    return { delivery, outcome };
  }

  async get(ctx: TenantContext, id: Ulid): Promise<WebhookDelivery> {
    const delivery = await this.deliveries.findById(ctx.tenantId, id);
    if (!delivery) throw new NotFoundError("WebhookDelivery", id);
    return delivery;
  }

  async list(
    ctx: TenantContext,
    filter?: { subscriptionId?: Ulid; status?: DeliveryStatus; eventType?: string },
  ): Promise<WebhookDelivery[]> {
    return this.deliveries.list(ctx.tenantId, filter);
  }

  async retry(ctx: TenantContext, id: Ulid, extraAttempts?: number): Promise<WebhookDelivery> {
    const delivery = await this.get(ctx, id);
    delivery.requeue(this.clock.now(), extraAttempts);
    await this.flush(delivery);
    return delivery;
  }

  async cancel(ctx: TenantContext, id: Ulid, reason: string): Promise<WebhookDelivery> {
    const delivery = await this.get(ctx, id);
    delivery.cancel(reason, this.clock.now());
    await this.flush(delivery);
    return delivery;
  }

  /** Bulk requeue after fixing a broken endpoint. */
  async retryDeadLetters(ctx: TenantContext, subscriptionId?: Ulid): Promise<number> {
    const deadLettered = await this.deliveries.list(ctx.tenantId, {
      status: "dead-lettered",
      subscriptionId,
    });
    for (const delivery of deadLettered) {
      delivery.requeue(this.clock.now());
      await this.flush(delivery);
    }
    return deadLettered.length;
  }

  async stats(ctx: TenantContext, subscriptionId?: Ulid): Promise<StatusCounts> {
    return this.deliveries.countsByStatus(ctx.tenantId, subscriptionId);
  }

  private async flush(delivery: WebhookDelivery): Promise<void> {
    await this.deliveries.save(delivery);
    await this.publisher.publishAll(delivery.pullEvents());
  }

  private async flushSubscription(subscription: WebhookSubscription): Promise<void> {
    await this.subscriptions.save(subscription);
    await this.publisher.publishAll(subscription.pullEvents());
  }
}

/** `Retry-After` may be seconds or an HTTP date. */
export function parseRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = new Date(header);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, date.getTime() - Date.now());
}
