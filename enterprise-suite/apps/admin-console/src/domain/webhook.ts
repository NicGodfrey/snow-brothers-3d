import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError } from "./errors.js";
import { AdminEventTypes, eventMatches, isValidEventFilter } from "./events.js";

/**
 * Webhook subscriptions and their delivery attempts.
 *
 * Deliveries are modelled explicitly rather than fired and forgotten: each one
 * records its attempts, the next retry time computed from an exponential
 * backoff, and the terminal outcome. Consecutive failures trip a circuit
 * breaker that pauses the subscription, so a customer endpoint that has been
 * down for a week stops generating traffic on its own.
 */

export const WEBHOOK_STATUSES = ["active", "paused", "disabled"] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialBackoffMs: number;
  readonly backoffFactor: number;
  readonly maxBackoffMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  initialBackoffMs: 30_000,
  backoffFactor: 3,
  maxBackoffMs: 3_600_000,
};

/** Failures in a row before the subscription pauses itself. */
export const CIRCUIT_BREAKER_THRESHOLD = 10;

export interface WebhookProps {
  name: string;
  url: string;
  secret: string;
  eventFilters: string[];
  status: WebhookStatus;
  headers: Record<string, string>;
  retryPolicy: RetryPolicy;
  consecutiveFailures: number;
  totalDeliveries: number;
  totalFailures: number;
  lastDeliveryAt?: IsoDateTime;
  lastFailureAt?: IsoDateTime;
  lastFailureReason?: string;
  pausedReason?: string;
  secretRotatedAt?: IsoDateTime;
}

export interface RegisterWebhookInput {
  readonly name: string;
  readonly url: string;
  readonly secret: string;
  readonly eventFilters: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly retryPolicy?: Partial<RetryPolicy>;
}

export class WebhookSubscription extends AggregateRoot<WebhookProps> {
  static register(
    tenantId: TenantId,
    input: RegisterWebhookInput,
    existing?: Partial<EntityProps>,
  ): WebhookSubscription {
    if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");
    const url = assertHttpsUrl(input.url);
    if (input.secret.length < 16) {
      throw ValidationError.single("secret", "must be at least 16 characters");
    }
    const filters = assertFilters(input.eventFilters);
    const retryPolicy = assertRetryPolicy({ ...DEFAULT_RETRY_POLICY, ...input.retryPolicy });

    const webhook = new WebhookSubscription(
      tenantId,
      {
        name: input.name.trim(),
        url,
        secret: input.secret,
        eventFilters: filters,
        status: "active",
        headers: sanitizeHeaders(input.headers ?? {}),
        retryPolicy,
        consecutiveFailures: 0,
        totalDeliveries: 0,
        totalFailures: 0,
      },
      existing,
    );
    webhook.raise(
      envelope({
        eventType: AdminEventTypes.webhookRegistered,
        aggregateType: "WebhookSubscription",
        aggregateId: webhook.id,
        tenantId,
        payload: { name: webhook.props.name, url, eventFilters: filters },
      }),
    );
    return webhook;
  }

  get name(): string {
    return this.props.name;
  }
  get url(): string {
    return this.props.url;
  }
  get status(): WebhookStatus {
    return this.props.status;
  }
  get eventFilters(): readonly string[] {
    return this.props.eventFilters;
  }
  get headers(): Readonly<Record<string, string>> {
    return this.props.headers;
  }
  get retryPolicy(): RetryPolicy {
    return this.props.retryPolicy;
  }
  get secret(): string {
    return this.props.secret;
  }
  get consecutiveFailures(): number {
    return this.props.consecutiveFailures;
  }
  get stats(): { deliveries: number; failures: number; lastDeliveryAt?: IsoDateTime } {
    return {
      deliveries: this.props.totalDeliveries,
      failures: this.props.totalFailures,
      lastDeliveryAt: this.props.lastDeliveryAt,
    };
  }

  /** Active subscriptions whose filters match the event type. */
  isInterestedIn(eventType: string): boolean {
    if (this.props.status !== "active") return false;
    return this.props.eventFilters.some((filter) => eventMatches(filter, eventType));
  }

  update(patch: {
    name?: string;
    url?: string;
    eventFilters?: readonly string[];
    headers?: Readonly<Record<string, string>>;
    retryPolicy?: Partial<RetryPolicy>;
  }): void {
    this.assertNotDisabled();
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw ValidationError.single("name", "is required");
      this.props.name = patch.name.trim();
    }
    if (patch.url !== undefined) this.props.url = assertHttpsUrl(patch.url);
    if (patch.eventFilters !== undefined) {
      this.props.eventFilters = assertFilters(patch.eventFilters);
    }
    if (patch.headers !== undefined) this.props.headers = sanitizeHeaders(patch.headers);
    if (patch.retryPolicy !== undefined) {
      this.props.retryPolicy = assertRetryPolicy({
        ...this.props.retryPolicy,
        ...patch.retryPolicy,
      });
    }
    this.raise(
      envelope({
        eventType: AdminEventTypes.webhookUpdated,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, url: this.props.url, filters: this.props.eventFilters },
      }),
    );
  }

  rotateSecret(secret: string, at: IsoDateTime): void {
    this.assertNotDisabled();
    if (secret.length < 16) throw ValidationError.single("secret", "must be at least 16 characters");
    if (secret === this.props.secret) {
      throw ValidationError.single("secret", "must differ from the current secret");
    }
    this.props.secret = secret;
    this.props.secretRotatedAt = at;
    this.raise(
      envelope({
        eventType: AdminEventTypes.webhookSecretRotated,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, rotatedAt: at },
      }),
    );
  }

  pause(reason: string): void {
    this.assertNotDisabled();
    if (this.props.status === "paused") return;
    this.props.status = "paused";
    this.props.pausedReason = reason;
    this.raise(
      envelope({
        eventType: AdminEventTypes.webhookPaused,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, reason },
      }),
    );
  }

  resume(): void {
    this.assertNotDisabled();
    if (this.props.status === "active") return;
    this.props.status = "active";
    this.props.pausedReason = undefined;
    this.props.consecutiveFailures = 0;
    this.raise(
      envelope({
        eventType: AdminEventTypes.webhookResumed,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name },
      }),
    );
  }

  disable(): void {
    this.props.status = "disabled";
    this.raise(
      envelope({
        eventType: AdminEventTypes.webhookDisabled,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name },
      }),
    );
  }

  recordSuccess(at: IsoDateTime): void {
    this.props.totalDeliveries += 1;
    this.props.consecutiveFailures = 0;
    this.props.lastDeliveryAt = at;
    this.touch();
  }

  /** Returns true when the failure tripped the breaker and paused the hook. */
  recordFailure(at: IsoDateTime, reason: string): boolean {
    this.props.totalDeliveries += 1;
    this.props.totalFailures += 1;
    this.props.consecutiveFailures += 1;
    this.props.lastFailureAt = at;
    this.props.lastFailureReason = reason;

    this.raise(
      envelope({
        eventType: AdminEventTypes.webhookDeliveryFailed,
        aggregateType: "WebhookSubscription",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          name: this.props.name,
          reason,
          consecutiveFailures: this.props.consecutiveFailures,
        },
      }),
    );

    if (
      this.props.status === "active" &&
      this.props.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD
    ) {
      this.pause(`circuit breaker: ${this.props.consecutiveFailures} consecutive failures`);
      return true;
    }
    return false;
  }

  /** Secrets never appear in API responses. */
  toPublicJSON(): Record<string, unknown> {
    const { secret, ...rest } = this.toJSON();
    return { ...rest, secretHint: `${secret.slice(0, 4)}…${secret.slice(-2)}` };
  }

  private assertNotDisabled(): void {
    if (this.props.status === "disabled") {
      throw new InvalidStateError(`Webhook ${this.props.name} is disabled`);
    }
  }
}

export const DELIVERY_STATUSES = ["pending", "delivered", "failed", "dead"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface DeliveryAttempt {
  readonly attempt: number;
  readonly at: IsoDateTime;
  readonly statusCode?: number;
  readonly error?: string;
  readonly durationMs: number;
}

/**
 * One event queued for one subscription. Kept as its own record so a redelivery
 * is auditable and a poison payload can be inspected after it goes `dead`.
 */
export class WebhookDelivery {
  readonly id: Ulid;
  readonly attempts: DeliveryAttempt[] = [];
  status: DeliveryStatus = "pending";
  nextAttemptAt: IsoDateTime;
  completedAt?: IsoDateTime;

  constructor(
    readonly tenantId: TenantId,
    readonly webhookId: Ulid,
    readonly eventId: Ulid,
    readonly eventType: string,
    readonly payload: unknown,
    readonly createdAt: IsoDateTime,
    private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {
    this.id = newId("whd");
    this.nextAttemptAt = createdAt;
  }

  get attemptCount(): number {
    return this.attempts.length;
  }

  isDue(now: IsoDateTime): boolean {
    return this.status === "pending" && Date.parse(this.nextAttemptAt) <= Date.parse(now);
  }

  succeed(at: IsoDateTime, statusCode: number, durationMs: number): void {
    this.attempts.push({ attempt: this.attemptCount + 1, at, statusCode, durationMs });
    this.status = "delivered";
    this.completedAt = at;
  }

  /**
   * Records a failed attempt and schedules the retry. Once `maxAttempts` is
   * spent the delivery is `dead` and stays for inspection rather than looping.
   */
  fail(at: IsoDateTime, error: string, statusCode: number | undefined, durationMs: number): void {
    this.attempts.push({ attempt: this.attemptCount + 1, at, statusCode, error, durationMs });
    if (this.attemptCount >= this.policy.maxAttempts) {
      this.status = "dead";
      this.completedAt = at;
      return;
    }
    this.status = "pending";
    this.nextAttemptAt = new Date(Date.parse(at) + this.backoffMs()).toISOString() as IsoDateTime;
  }

  backoffMs(): number {
    const raw =
      this.policy.initialBackoffMs * this.policy.backoffFactor ** (this.attemptCount - 1);
    return Math.min(this.policy.maxBackoffMs, Math.round(raw));
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      tenantId: this.tenantId,
      webhookId: this.webhookId,
      eventId: this.eventId,
      eventType: this.eventType,
      status: this.status,
      attempts: this.attempts,
      nextAttemptAt: this.nextAttemptAt,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
    };
  }
}

export function assertHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw ValidationError.single("url", `"${value}" is not a valid URL`);
  }
  // http is tolerated for loopback so local integration tests can run.
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw ValidationError.single("url", "must use https (http is allowed only for loopback)");
  }
  return url.toString();
}

function assertFilters(filters: readonly string[]): string[] {
  if (filters.length === 0) {
    throw ValidationError.single("eventFilters", "at least one event filter is required");
  }
  const invalid = filters.filter((filter) => !isValidEventFilter(filter));
  if (invalid.length > 0) {
    throw ValidationError.from(
      invalid.map((filter) => ({
        field: "eventFilters",
        message: `"${filter}" is not a known event type or namespace wildcard`,
      })),
    );
  }
  return [...new Set(filters)].sort();
}

function assertRetryPolicy(policy: RetryPolicy): RetryPolicy {
  if (policy.maxAttempts < 1 || policy.maxAttempts > 10) {
    throw ValidationError.single("retryPolicy.maxAttempts", "must be between 1 and 10");
  }
  if (policy.initialBackoffMs < 1_000) {
    throw ValidationError.single("retryPolicy.initialBackoffMs", "must be at least 1000ms");
  }
  if (policy.backoffFactor < 1 || policy.backoffFactor > 10) {
    throw ValidationError.single("retryPolicy.backoffFactor", "must be between 1 and 10");
  }
  if (policy.maxBackoffMs < policy.initialBackoffMs) {
    throw ValidationError.single("retryPolicy.maxBackoffMs", "must be >= initialBackoffMs");
  }
  return policy;
}

/** Callers cannot override the headers the dispatcher sets itself. */
const RESERVED_HEADERS = new Set([
  "content-type",
  "x-webhook-signature",
  "x-webhook-timestamp",
  "x-webhook-event",
  "x-webhook-delivery",
  "x-tenant-id",
]);

function sanitizeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (RESERVED_HEADERS.has(key)) {
      throw ValidationError.single("headers", `"${name}" is set by the dispatcher`);
    }
    out[key] = value;
  }
  return out;
}
