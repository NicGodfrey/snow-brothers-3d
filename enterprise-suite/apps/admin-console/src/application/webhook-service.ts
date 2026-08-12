import {
  NotFoundError,
  type EventEnvelope,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError } from "../domain/errors.js";
import {
  WebhookDelivery,
  WebhookSubscription,
  type RegisterWebhookInput,
  type RetryPolicy,
} from "../domain/webhook.js";
import type { AuditService } from "./audit-service.js";
import type { TenantService } from "./tenant-service.js";
import type {
  Clock,
  CommandContext,
  DeliveryRepository,
  Outbox,
  SecretGenerator,
  Signer,
  WebhookRepository,
  WebhookSender,
} from "./ports.js";

/**
 * Webhook administration and delivery.
 *
 * `enqueue` fans an event out to the subscriptions that match it, creating one
 * delivery record each. `drain` performs the attempts that are due, signing
 * each request and applying the subscription's retry policy on failure. Both
 * halves are explicit so a caller (a test, a worker loop, an HTTP handler)
 * controls when work happens instead of racing background timers.
 */

export interface DeliveryReport {
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly dead: number;
  readonly pausedWebhooks: readonly string[];
}

export interface RegisterWebhookRequest extends Omit<RegisterWebhookInput, "secret"> {
  /** Omit to have the service mint one; it is returned exactly once. */
  readonly secret?: string;
}

export class WebhookService {
  constructor(
    private readonly webhooks: WebhookRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly tenantService: TenantService,
    private readonly sender: WebhookSender,
    private readonly signer: Signer,
    private readonly secrets: SecretGenerator,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly options: { timeoutMs?: number } = {},
  ) {}

  async register(
    ctx: CommandContext,
    input: RegisterWebhookRequest,
  ): Promise<{ webhook: WebhookSubscription; secret: string }> {
    const tenant = this.tenantService.requireOperational(ctx.tenantId);
    tenant.assertWithinQuota("webhooks", this.webhooks.count(ctx.tenantId));

    const secret = input.secret ?? this.secrets.generate(32);
    const webhook = WebhookSubscription.register(ctx.tenantId, { ...input, secret });
    this.webhooks.save(webhook);

    await this.outbox.publish(webhook.pullEvents());
    this.audit.record(ctx, {
      action: "webhook.register",
      resourceType: "WebhookSubscription",
      resourceId: String(webhook.id),
      after: webhook.toPublicJSON(),
    });
    return { webhook, secret };
  }

  require(tenantId: TenantId, id: string): WebhookSubscription {
    const webhook = this.webhooks.byId(tenantId, id as Ulid);
    if (!webhook) throw new NotFoundError("WebhookSubscription", id);
    return webhook;
  }

  list(tenantId: TenantId, filter: { status?: string } = {}): WebhookSubscription[] {
    return this.webhooks.list(tenantId, filter);
  }

  async update(
    ctx: CommandContext,
    id: string,
    patch: {
      name?: string;
      url?: string;
      eventFilters?: readonly string[];
      headers?: Record<string, string>;
      retryPolicy?: Partial<RetryPolicy>;
    },
  ): Promise<WebhookSubscription> {
    const webhook = this.require(ctx.tenantId, id);
    const before = webhook.toPublicJSON();
    webhook.update(patch);
    this.webhooks.save(webhook);
    await this.outbox.publish(webhook.pullEvents());
    this.audit.record(ctx, {
      action: "webhook.update",
      resourceType: "WebhookSubscription",
      resourceId: id,
      before,
      after: webhook.toPublicJSON(),
    });
    return webhook;
  }

  async rotateSecret(ctx: CommandContext, id: string): Promise<{ secret: string }> {
    const webhook = this.require(ctx.tenantId, id);
    const secret = this.secrets.generate(32);
    webhook.rotateSecret(secret, this.clock.now());
    this.webhooks.save(webhook);
    await this.outbox.publish(webhook.pullEvents());
    this.audit.record(ctx, {
      action: "webhook.rotate-secret",
      resourceType: "WebhookSubscription",
      resourceId: id,
    });
    return { secret };
  }

  async pause(ctx: CommandContext, id: string, reason: string): Promise<WebhookSubscription> {
    const webhook = this.require(ctx.tenantId, id);
    webhook.pause(reason);
    this.webhooks.save(webhook);
    await this.outbox.publish(webhook.pullEvents());
    this.audit.record(ctx, {
      action: "webhook.pause",
      resourceType: "WebhookSubscription",
      resourceId: id,
      reason,
    });
    return webhook;
  }

  async resume(ctx: CommandContext, id: string): Promise<WebhookSubscription> {
    const webhook = this.require(ctx.tenantId, id);
    webhook.resume();
    this.webhooks.save(webhook);
    await this.outbox.publish(webhook.pullEvents());
    this.audit.record(ctx, {
      action: "webhook.resume",
      resourceType: "WebhookSubscription",
      resourceId: id,
    });
    return webhook;
  }

  async disable(ctx: CommandContext, id: string): Promise<WebhookSubscription> {
    const webhook = this.require(ctx.tenantId, id);
    webhook.disable();
    this.webhooks.save(webhook);
    await this.outbox.publish(webhook.pullEvents());
    this.audit.record(ctx, {
      action: "webhook.disable",
      resourceType: "WebhookSubscription",
      resourceId: id,
    });
    return webhook;
  }

  /** Queues one event for every interested subscription in the tenant. */
  enqueue(event: EventEnvelope): WebhookDelivery[] {
    const subscribers = this.webhooks
      .subscribersFor(event.tenantId, event.eventType)
      .filter((webhook) => webhook.isInterestedIn(event.eventType));

    return subscribers.map((webhook) => {
      const delivery = new WebhookDelivery(
        event.tenantId,
        webhook.id,
        event.eventId,
        event.eventType,
        event.payload,
        this.clock.now(),
        webhook.retryPolicy,
      );
      this.deliveries.save(delivery);
      return delivery;
    });
  }

  enqueueAll(events: readonly EventEnvelope[]): WebhookDelivery[] {
    return events.flatMap((event) => this.enqueue(event));
  }

  /** Performs every attempt that is due, honouring per-hook retry policies. */
  async drain(limit = 50): Promise<DeliveryReport> {
    const now = this.clock.now();
    const due = this.deliveries.due(now, limit);
    let delivered = 0;
    let failed = 0;
    let dead = 0;
    const paused: string[] = [];

    for (const delivery of due) {
      const webhook = this.webhooks.byId(delivery.tenantId, delivery.webhookId);
      if (!webhook || webhook.status !== "active") {
        // The subscription went away or was paused after the event was queued.
        delivery.fail(this.clock.now(), "subscription is not active", undefined, 0);
        this.deliveries.save(delivery);
        if (delivery.status === "dead") dead += 1;
        else failed += 1;
        continue;
      }

      const result = await this.attempt(webhook, delivery);
      if (result.delivered) delivered += 1;
      else if (delivery.status === "dead") dead += 1;
      else failed += 1;
      if (result.paused) paused.push(String(webhook.id));
    }

    return { attempted: due.length, delivered, failed, dead, pausedWebhooks: paused };
  }

  /** Sends a synthetic event so an operator can verify a new endpoint. */
  async test(ctx: CommandContext, id: string): Promise<{ delivery: WebhookDelivery; delivered: boolean }> {
    const webhook = this.require(ctx.tenantId, id);
    if (webhook.status === "disabled") {
      throw new InvalidStateError(`Webhook ${webhook.name} is disabled`);
    }
    const delivery = new WebhookDelivery(
      ctx.tenantId,
      webhook.id,
      `evt_test_${Date.now().toString(36)}` as Ulid,
      "admin.webhook.test",
      { message: "Test delivery from the admin console", requestedBy: ctx.actor },
      this.clock.now(),
      webhook.retryPolicy,
    );
    this.deliveries.save(delivery);
    const result = await this.attempt(webhook, delivery, { countStats: false });
    this.audit.record(ctx, {
      action: "webhook.test",
      resourceType: "WebhookSubscription",
      resourceId: id,
      after: { delivered: result.delivered, attempts: delivery.attemptCount },
    });
    return { delivery, delivered: result.delivered };
  }

  deliveriesFor(tenantId: TenantId, webhookId: string, limit = 20): WebhookDelivery[] {
    return this.deliveries.forWebhook(tenantId, webhookId as Ulid, limit);
  }

  /** Deliveries stuck in `dead`, which is what an operator needs to see. */
  deadLetters(tenantId: TenantId): WebhookDelivery[] {
    return this.deliveries.list(tenantId, { status: "dead" });
  }

  signatureHeaders(
    secret: string,
    body: string,
    at: IsoDateTime,
  ): { "x-webhook-timestamp": string; "x-webhook-signature": string } {
    return {
      "x-webhook-timestamp": at,
      "x-webhook-signature": `sha256=${this.signer.sign(secret, at, body)}`,
    };
  }

  private async attempt(
    webhook: WebhookSubscription,
    delivery: WebhookDelivery,
    options: { countStats?: boolean } = {},
  ): Promise<{ delivered: boolean; paused: boolean }> {
    const at = this.clock.now();
    const body = JSON.stringify({
      id: delivery.id,
      eventId: delivery.eventId,
      type: delivery.eventType,
      tenantId: delivery.tenantId,
      occurredAt: delivery.createdAt,
      attempt: delivery.attemptCount + 1,
      data: delivery.payload,
    });
    const headers: Record<string, string> = {
      ...webhook.headers,
      "content-type": "application/json",
      "x-tenant-id": String(delivery.tenantId),
      "x-webhook-event": delivery.eventType,
      "x-webhook-delivery": String(delivery.id),
      ...this.signatureHeaders(webhook.secret, body, at),
    };

    const response = await this.sender.send(
      webhook.url,
      headers,
      body,
      this.options.timeoutMs ?? 5_000,
    );
    const countStats = options.countStats !== false;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      delivery.succeed(this.clock.now(), response.statusCode, response.durationMs);
      this.deliveries.save(delivery);
      if (countStats) {
        webhook.recordSuccess(this.clock.now());
        this.webhooks.save(webhook);
      }
      return { delivered: true, paused: false };
    }

    const reason = response.error ?? `HTTP ${response.statusCode}`;
    delivery.fail(this.clock.now(), reason, response.statusCode, response.durationMs);
    this.deliveries.save(delivery);

    let paused = false;
    if (countStats) {
      paused = webhook.recordFailure(this.clock.now(), reason);
      this.webhooks.save(webhook);
      await this.outbox.publish(webhook.pullEvents());
    }
    return { delivered: false, paused };
  }
}
