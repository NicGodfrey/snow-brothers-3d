/**
 * Webhook subscription management: registration, lifecycle, secret rotation.
 * Delivery itself lives in `delivery-service.ts`.
 */
import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { RetryPolicy } from "@enterprise-suite/event-bus";
import type { WebhookSubscriptionRepository } from "../domain/repositories.js";
import { WebhookSubscription, type WebhookStatus } from "../domain/webhook.js";
import type { Clock, EventPublisher, SecretGenerator } from "./ports.js";

export interface CreateWebhookCommand {
  name: string;
  endpointUrl: string;
  eventPatterns: readonly string[];
  description?: string;
  headers?: Record<string, string>;
  secret?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryOverride?: Partial<RetryPolicy>;
  autoDisableThreshold?: number;
}

export class WebhookService {
  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly secrets: SecretGenerator,
  ) {}

  /**
   * Registers an endpoint. Returns the plaintext secret exactly once — it is
   * redacted from every later read, mirroring how real webhook consoles work.
   */
  async create(
    ctx: TenantContext,
    cmd: CreateWebhookCommand,
  ): Promise<{ subscription: WebhookSubscription; secret: string }> {
    const existing = await this.subscriptions.findByName(ctx.tenantId, cmd.name.trim());
    if (existing) throw new ConflictError(`A webhook named '${cmd.name}' already exists`);

    const subscription = WebhookSubscription.create({
      tenantId: ctx.tenantId,
      name: cmd.name,
      endpointUrl: cmd.endpointUrl,
      eventPatterns: cmd.eventPatterns,
      description: cmd.description,
      headers: cmd.headers,
      secret: cmd.secret ?? this.secrets.generate(),
      timeoutMs: cmd.timeoutMs,
      maxAttempts: cmd.maxAttempts,
      retryOverride: cmd.retryOverride,
      autoDisableThreshold: cmd.autoDisableThreshold,
    });
    await this.flush(subscription);
    return { subscription, secret: subscription.secret };
  }

  async get(ctx: TenantContext, id: Ulid): Promise<WebhookSubscription> {
    const subscription = await this.subscriptions.findById(ctx.tenantId, id);
    if (!subscription) throw new NotFoundError("WebhookSubscription", id);
    return subscription;
  }

  async list(
    ctx: TenantContext,
    filter?: { status?: WebhookStatus; eventType?: string },
  ): Promise<WebhookSubscription[]> {
    return this.subscriptions.list(ctx.tenantId, filter);
  }

  async update(
    ctx: TenantContext,
    id: Ulid,
    changes: {
      endpointUrl?: string;
      eventPatterns?: readonly string[];
      headers?: Record<string, string>;
      timeoutMs?: number;
      maxAttempts?: number;
      autoDisableThreshold?: number;
    },
  ): Promise<WebhookSubscription> {
    const subscription = await this.get(ctx, id);
    if (changes.endpointUrl !== undefined) subscription.updateEndpoint(changes.endpointUrl);
    if (changes.eventPatterns !== undefined) subscription.updatePatterns(changes.eventPatterns);
    if (changes.headers !== undefined) subscription.updateHeaders(changes.headers);
    if (
      changes.timeoutMs !== undefined ||
      changes.maxAttempts !== undefined ||
      changes.autoDisableThreshold !== undefined
    ) {
      subscription.updateDelivery(changes);
    }
    await this.flush(subscription);
    return subscription;
  }

  async pause(ctx: TenantContext, id: Ulid): Promise<WebhookSubscription> {
    const subscription = await this.get(ctx, id);
    subscription.pause();
    await this.flush(subscription);
    return subscription;
  }

  async resume(ctx: TenantContext, id: Ulid): Promise<WebhookSubscription> {
    const subscription = await this.get(ctx, id);
    subscription.resume();
    await this.flush(subscription);
    return subscription;
  }

  async disable(ctx: TenantContext, id: Ulid, reason: string): Promise<WebhookSubscription> {
    const subscription = await this.get(ctx, id);
    subscription.disable(reason, this.clock.now());
    await this.flush(subscription);
    return subscription;
  }

  async enable(ctx: TenantContext, id: Ulid): Promise<WebhookSubscription> {
    const subscription = await this.get(ctx, id);
    subscription.enable();
    await this.flush(subscription);
    return subscription;
  }

  /** Rotates the signing secret; the old one keeps verifying for `graceMs`. */
  async rotateSecret(
    ctx: TenantContext,
    id: Ulid,
    options?: { secret?: string; graceMs?: number },
  ): Promise<{ subscription: WebhookSubscription; secret: string }> {
    const subscription = await this.get(ctx, id);
    const secret = subscription.rotateSecret(
      this.clock.now(),
      options?.secret ?? this.secrets.generate(),
      options?.graceMs,
    );
    await this.flush(subscription);
    return { subscription, secret };
  }

  async delete(ctx: TenantContext, id: Ulid): Promise<void> {
    const subscription = await this.get(ctx, id);
    if (subscription.status !== "disabled") {
      throw new ConflictError("Disable the subscription before deleting it");
    }
    await this.subscriptions.delete(ctx.tenantId, subscription.id);
  }

  private async flush(subscription: WebhookSubscription): Promise<void> {
    await this.subscriptions.save(subscription);
    await this.publisher.publishAll(subscription.pullEvents());
  }
}
