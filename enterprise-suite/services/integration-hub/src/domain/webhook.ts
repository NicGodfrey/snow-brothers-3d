/**
 * Webhook subscription aggregate.
 *
 * A tenant registers an endpoint plus the event patterns it wants. The hub
 * fans matching events out as signed HTTP POSTs (see `delivery.ts`).
 *
 * Operational concerns encoded here:
 *  - endpoints are validated (no credentials in the URL, no reserved headers)
 *  - secrets rotate with a grace window so in-flight deliveries signed with
 *    the old secret still verify on the receiver side
 *  - repeated failures trip a circuit breaker that auto-disables the
 *    subscription, protecting both sides from an endless failing fan-out
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { matchAnyTopic, parseTopicPattern, type RetryPolicy } from "@enterprise-suite/event-bus";
import { IntegrationEventTypes, type WebhookSubscriptionAutoDisabledPayload } from "./events.js";
import { generateSecret, SIGNATURE_HEADER } from "./signature.js";
import { addMs, isAfter } from "./time.js";

export type WebhookStatus = "active" | "paused" | "disabled";

export interface RotatedSecret {
  readonly secret: string;
  readonly expiresAt: IsoDateTime;
}

interface WebhookSubscriptionProps {
  name: string;
  description?: string;
  endpointUrl: string;
  eventPatterns: string[];
  status: WebhookStatus;
  secret: string;
  previousSecret?: RotatedSecret;
  headers: Record<string, string>;
  timeoutMs: number;
  maxAttempts: number;
  retryOverride?: Partial<RetryPolicy>;
  autoDisableThreshold: number;
  consecutiveFailures: number;
  totalDeliveries: number;
  totalFailures: number;
  lastSuccessAt?: IsoDateTime;
  lastFailureAt?: IsoDateTime;
  disabledAt?: IsoDateTime;
  disabledReason?: string;
}

export const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "user-agent",
  SIGNATURE_HEADER,
  "x-es-event-id",
  "x-es-event-type",
  "x-es-delivery-id",
  "x-es-attempt",
  "x-es-tenant-id",
]);

export const DEFAULT_SECRET_GRACE_MS = 24 * 60 * 60 * 1000;

/** Parses and validates a webhook endpoint URL. */
export function assertValidEndpoint(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DomainError(`endpointUrl '${url}' is not a valid URL`, "VALIDATION");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new DomainError("endpointUrl must use http or https", "VALIDATION");
  }
  if (parsed.username || parsed.password) {
    throw new DomainError("endpointUrl must not embed credentials; use a header instead", "VALIDATION");
  }
  if (parsed.hash) {
    throw new DomainError("endpointUrl must not contain a fragment", "VALIDATION");
  }
  return parsed;
}

function assertValidHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase().trim();
    if (!key) throw new DomainError("header names must be non-empty", "VALIDATION");
    if (RESERVED_HEADERS.has(key)) {
      throw new DomainError(`header '${key}' is set by the hub and cannot be overridden`, "VALIDATION");
    }
    if (!/^[a-z0-9-]+$/.test(key)) {
      throw new DomainError(`header name '${rawKey}' contains invalid characters`, "VALIDATION");
    }
    if (typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new DomainError(`header '${key}' has an invalid value`, "VALIDATION");
    }
    normalized[key] = value;
  }
  return normalized;
}

function assertPatterns(patterns: readonly string[]): string[] {
  if (patterns.length === 0) {
    throw new DomainError("at least one event pattern is required", "VALIDATION");
  }
  const unique = [...new Set(patterns.map((pattern) => pattern.trim()))];
  for (const pattern of unique) parseTopicPattern(pattern);
  return unique;
}

export class WebhookSubscription extends AggregateRoot<WebhookSubscriptionProps> {
  private constructor(
    tenantId: TenantId,
    props: WebhookSubscriptionProps,
    existing?: Partial<EntityProps>,
  ) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    name: string;
    endpointUrl: string;
    eventPatterns: readonly string[];
    description?: string;
    secret?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxAttempts?: number;
    retryOverride?: Partial<RetryPolicy>;
    autoDisableThreshold?: number;
  }): WebhookSubscription {
    if (!input.name.trim()) throw new DomainError("name is required", "VALIDATION");
    assertValidEndpoint(input.endpointUrl);
    const timeoutMs = input.timeoutMs ?? 10_000;
    if (timeoutMs < 100 || timeoutMs > 60_000) {
      throw new DomainError("timeoutMs must be between 100 and 60000", "VALIDATION");
    }
    const threshold = input.autoDisableThreshold ?? 20;
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new DomainError("autoDisableThreshold must be a positive integer", "VALIDATION");
    }

    const subscription = new WebhookSubscription(input.tenantId, {
      name: input.name.trim(),
      description: input.description?.trim(),
      endpointUrl: input.endpointUrl,
      eventPatterns: assertPatterns(input.eventPatterns),
      status: "active",
      secret: input.secret ?? generateSecret(),
      headers: assertValidHeaders(input.headers ?? {}),
      timeoutMs,
      maxAttempts: input.maxAttempts ?? 8,
      retryOverride: input.retryOverride,
      autoDisableThreshold: threshold,
      consecutiveFailures: 0,
      totalDeliveries: 0,
      totalFailures: 0,
    });
    subscription.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookSubscriptionCreated,
        aggregateType: "WebhookSubscription",
        aggregateId: subscription.id,
        tenantId: input.tenantId,
        payload: {
          name: subscription.props.name,
          endpointUrl: subscription.props.endpointUrl,
          eventPatterns: subscription.props.eventPatterns,
        },
      }),
    );
    return subscription;
  }

  static rehydrate(
    tenantId: TenantId,
    props: WebhookSubscriptionProps,
    existing: Partial<EntityProps>,
  ): WebhookSubscription {
    return new WebhookSubscription(tenantId, props, existing);
  }

  get name(): string { return this.props.name; }
  get endpointUrl(): string { return this.props.endpointUrl; }
  get eventPatterns(): readonly string[] { return this.props.eventPatterns; }
  get status(): WebhookStatus { return this.props.status; }
  get secret(): string { return this.props.secret; }
  get headers(): Readonly<Record<string, string>> { return this.props.headers; }
  get timeoutMs(): number { return this.props.timeoutMs; }
  get maxAttempts(): number { return this.props.maxAttempts; }
  get retryOverride(): Partial<RetryPolicy> | undefined { return this.props.retryOverride; }
  get consecutiveFailures(): number { return this.props.consecutiveFailures; }
  get autoDisableThreshold(): number { return this.props.autoDisableThreshold; }
  get totalDeliveries(): number { return this.props.totalDeliveries; }
  get totalFailures(): number { return this.props.totalFailures; }
  get disabledReason(): string | undefined { return this.props.disabledReason; }
  get lastSuccessAt(): IsoDateTime | undefined { return this.props.lastSuccessAt; }
  get lastFailureAt(): IsoDateTime | undefined { return this.props.lastFailureAt; }

  /** Active subscriptions receive fan-out; paused ones do not. */
  get isActive(): boolean {
    return this.props.status === "active";
  }

  matches(eventType: string): boolean {
    return matchAnyTopic(this.props.eventPatterns, eventType);
  }

  /** Secrets a receiver may validate against: current first, then the rotated-out one. */
  verificationSecrets(now: IsoDateTime): string[] {
    const secrets = [this.props.secret];
    const previous = this.props.previousSecret;
    if (previous && !isAfter(now, previous.expiresAt)) secrets.push(previous.secret);
    return secrets;
  }

  updateEndpoint(endpointUrl: string): void {
    assertValidEndpoint(endpointUrl);
    this.props.endpointUrl = endpointUrl;
    this.emitUpdated({ endpointUrl });
  }

  updatePatterns(patterns: readonly string[]): void {
    this.props.eventPatterns = assertPatterns(patterns);
    this.emitUpdated({ eventPatterns: this.props.eventPatterns });
  }

  updateHeaders(headers: Record<string, string>): void {
    this.props.headers = assertValidHeaders(headers);
    this.emitUpdated({ headers: Object.keys(this.props.headers) });
  }

  updateDelivery(input: { timeoutMs?: number; maxAttempts?: number; autoDisableThreshold?: number }): void {
    if (input.timeoutMs !== undefined) {
      if (input.timeoutMs < 100 || input.timeoutMs > 60_000) {
        throw new DomainError("timeoutMs must be between 100 and 60000", "VALIDATION");
      }
      this.props.timeoutMs = input.timeoutMs;
    }
    if (input.maxAttempts !== undefined) {
      if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 50) {
        throw new DomainError("maxAttempts must be an integer between 1 and 50", "VALIDATION");
      }
      this.props.maxAttempts = input.maxAttempts;
    }
    if (input.autoDisableThreshold !== undefined) {
      if (!Number.isInteger(input.autoDisableThreshold) || input.autoDisableThreshold < 1) {
        throw new DomainError("autoDisableThreshold must be a positive integer", "VALIDATION");
      }
      this.props.autoDisableThreshold = input.autoDisableThreshold;
    }
    this.emitUpdated({
      timeoutMs: this.props.timeoutMs,
      maxAttempts: this.props.maxAttempts,
      autoDisableThreshold: this.props.autoDisableThreshold,
    });
  }

  private emitUpdated(changes: Record<string, unknown>): void {
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookSubscriptionUpdated,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, changes },
      }),
    );
  }

  pause(): void {
    if (this.props.status === "disabled") {
      throw new ConflictError("Disabled subscriptions must be enabled before pausing");
    }
    if (this.props.status === "paused") return;
    this.props.status = "paused";
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookSubscriptionPaused,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name },
      }),
    );
  }

  resume(): void {
    if (this.props.status !== "paused") {
      throw new ConflictError(`Only paused subscriptions can resume (status=${this.props.status})`);
    }
    this.props.status = "active";
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookSubscriptionResumed,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name },
      }),
    );
  }

  disable(reason: string, now: IsoDateTime): void {
    if (!reason.trim()) throw new DomainError("reason is required", "VALIDATION");
    this.props.status = "disabled";
    this.props.disabledAt = now;
    this.props.disabledReason = reason.trim();
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookSubscriptionDisabled,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, reason: reason.trim() },
      }),
    );
  }

  /** Re-enables a disabled subscription and clears the failure streak. */
  enable(): void {
    if (this.props.status !== "disabled") {
      throw new ConflictError(`Only disabled subscriptions can be enabled (status=${this.props.status})`);
    }
    this.props.status = "active";
    this.props.disabledAt = undefined;
    this.props.disabledReason = undefined;
    this.props.consecutiveFailures = 0;
    this.emitUpdated({ status: "active" });
  }

  rotateSecret(now: IsoDateTime, newSecret?: string, graceMs = DEFAULT_SECRET_GRACE_MS): string {
    const secret = newSecret ?? generateSecret();
    if (secret === this.props.secret) {
      throw new ConflictError("New secret must differ from the current one");
    }
    if (secret.length < 16) throw new DomainError("secret must be at least 16 characters", "VALIDATION");
    this.props.previousSecret = { secret: this.props.secret, expiresAt: addMs(now, graceMs) };
    this.props.secret = secret;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.WebhookSecretRotated,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          name: this.props.name,
          graceEndsAt: this.props.previousSecret.expiresAt,
        },
      }),
    );
    return secret;
  }

  recordDeliverySuccess(now: IsoDateTime): void {
    this.props.totalDeliveries += 1;
    this.props.consecutiveFailures = 0;
    this.props.lastSuccessAt = now;
    this.touch();
  }

  /**
   * Records a permanently failed delivery. Trips the circuit breaker once the
   * failure streak reaches the threshold.
   */
  recordDeliveryFailure(now: IsoDateTime): { autoDisabled: boolean } {
    this.props.totalDeliveries += 1;
    this.props.totalFailures += 1;
    this.props.consecutiveFailures += 1;
    this.props.lastFailureAt = now;
    this.touch();

    if (
      this.props.status === "active" &&
      this.props.consecutiveFailures >= this.props.autoDisableThreshold
    ) {
      this.props.status = "disabled";
      this.props.disabledAt = now;
      this.props.disabledReason = `auto-disabled after ${this.props.consecutiveFailures} consecutive delivery failures`;
      const payload: WebhookSubscriptionAutoDisabledPayload = {
        subscriptionId: this.id,
        endpointUrl: this.props.endpointUrl,
        consecutiveFailures: this.props.consecutiveFailures,
        threshold: this.props.autoDisableThreshold,
      };
      this.raise(
        envelope({
          eventType: IntegrationEventTypes.WebhookSubscriptionAutoDisabled,
          aggregateType: "WebhookSubscription",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload,
        }),
      );
      return { autoDisabled: true };
    }
    return { autoDisabled: false };
  }

  /**
   * API view. `toJSON()` (used by the repository) keeps the secret; this one
   * redacts it so it never leaves the service over HTTP.
   */
  toPublicJSON(): Record<string, unknown> {
    const { secret, previousSecret, ...rest } = this.toJSON();
    return {
      ...rest,
      secretHint: `${secret.slice(0, 10)}...`,
      secretRotationEndsAt: previousSecret?.expiresAt,
    };
  }
}
