/**
 * Idempotency keys for inbound commands.
 *
 * A caller sends `Idempotency-Key: <key>` with a mutating request. The hub
 * reserves the key before the work runs and stores the response when it
 * finishes, so a retry of the same request returns the original response
 * instead of executing twice.
 *
 * Three cases must be distinguished:
 *   - same key, same request fingerprint, completed  -> replay the response
 *   - same key, same fingerprint, still in progress  -> 409, retry later
 *   - same key, different fingerprint                -> 422, key reuse bug
 *
 * Keys expire: `expiresAt` bounds how long a response is replayable, after
 * which the key may be reserved again.
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
import { IntegrationEventTypes } from "./events.js";
import { fingerprint } from "./fingerprint.js";
import { addMs, isAfter } from "./time.js";

export type IdempotencyStatus = "in-progress" | "completed" | "failed";

export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

interface IdempotencyRecordProps {
  key: string;
  /** Endpoint or command name; keys are unique per scope. */
  scope: string;
  requestFingerprint: string;
  status: IdempotencyStatus;
  response?: StoredResponse;
  error?: string;
  reservedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  expiresAt: IsoDateTime;
  /** Total requests seen with this key, including the first. */
  requestCount: number;
  replayCount: number;
}

export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyKeyReuseError extends DomainError {
  constructor(key: string, scope: string) {
    super(
      `Idempotency key '${key}' was already used in scope '${scope}' with a different request payload`,
      "IDEMPOTENCY_KEY_REUSE",
      422,
    );
    this.name = "IdempotencyKeyReuseError";
  }
}

export class IdempotencyInProgressError extends ConflictError {
  constructor(key: string) {
    super(`A request with idempotency key '${key}' is still in progress`);
    this.name = "IdempotencyInProgressError";
  }
}

export class IdempotencyRecord extends AggregateRoot<IdempotencyRecordProps> {
  private constructor(
    tenantId: TenantId,
    props: IdempotencyRecordProps,
    existing?: Partial<EntityProps>,
  ) {
    super(tenantId, props, existing);
  }

  static reserve(input: {
    tenantId: TenantId;
    key: string;
    scope: string;
    request: unknown;
    now: IsoDateTime;
    ttlMs?: number;
  }): IdempotencyRecord {
    if (!input.key.trim()) throw new DomainError("idempotency key is required", "VALIDATION");
    if (input.key.length > 255) throw new DomainError("idempotency key must be <= 255 chars", "VALIDATION");
    if (!input.scope.trim()) throw new DomainError("scope is required", "VALIDATION");

    const record = new IdempotencyRecord(input.tenantId, {
      key: input.key.trim(),
      scope: input.scope.trim(),
      requestFingerprint: fingerprint(input.request),
      status: "in-progress",
      reservedAt: input.now,
      expiresAt: addMs(input.now, input.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS),
      requestCount: 1,
      replayCount: 0,
    });
    record.raise(
      envelope({
        eventType: IntegrationEventTypes.IdempotencyKeyReserved,
        aggregateType: "IdempotencyRecord",
        aggregateId: record.id,
        tenantId: input.tenantId,
        payload: { key: record.props.key, scope: record.props.scope },
      }),
    );
    return record;
  }

  static rehydrate(
    tenantId: TenantId,
    props: IdempotencyRecordProps,
    existing: Partial<EntityProps>,
  ): IdempotencyRecord {
    return new IdempotencyRecord(tenantId, props, existing);
  }

  get key(): string { return this.props.key; }
  get scope(): string { return this.props.scope; }
  get requestFingerprint(): string { return this.props.requestFingerprint; }
  get status(): IdempotencyStatus { return this.props.status; }
  get response(): StoredResponse | undefined { return this.props.response; }
  get error(): string | undefined { return this.props.error; }
  get expiresAt(): IsoDateTime { return this.props.expiresAt; }
  get requestCount(): number { return this.props.requestCount; }
  get replayCount(): number { return this.props.replayCount; }

  isExpired(now: IsoDateTime): boolean {
    return isAfter(now, this.props.expiresAt);
  }

  /** Rejects a retry whose body differs from the original request. */
  assertSameRequest(request: unknown): void {
    if (fingerprint(request) !== this.props.requestFingerprint) {
      this.raise(
        envelope({
          eventType: IntegrationEventTypes.IdempotencyConflictDetected,
          aggregateType: "IdempotencyRecord",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: { key: this.props.key, scope: this.props.scope },
        }),
      );
      throw new IdempotencyKeyReuseError(this.props.key, this.props.scope);
    }
  }

  /**
   * Handles a repeat request for this key: replays a stored response, or
   * signals that the original is still running.
   */
  serveReplay(request: unknown): StoredResponse {
    this.assertSameRequest(request);
    this.props.requestCount += 1;
    if (this.props.status === "in-progress") {
      this.touch();
      throw new IdempotencyInProgressError(this.props.key);
    }
    if (!this.props.response) {
      // A failed attempt is replayable as a failure, but has no stored body.
      throw new ConflictError(
        `Idempotency key '${this.props.key}' previously failed: ${this.props.error ?? "unknown error"}`,
      );
    }
    this.props.replayCount += 1;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.IdempotencyReplayServed,
        aggregateType: "IdempotencyRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          key: this.props.key,
          scope: this.props.scope,
          replayCount: this.props.replayCount,
        },
      }),
    );
    return this.props.response;
  }

  complete(response: StoredResponse, now: IsoDateTime): void {
    if (this.props.status !== "in-progress") {
      throw new ConflictError(`Idempotency key '${this.props.key}' is already ${this.props.status}`);
    }
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new DomainError("response.status must be a valid HTTP status code", "VALIDATION");
    }
    this.props.status = "completed";
    this.props.response = response;
    this.props.completedAt = now;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.IdempotencyKeyCompleted,
        aggregateType: "IdempotencyRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, scope: this.props.scope, status: response.status },
      }),
    );
  }

  /**
   * Marks the attempt failed. The key is released for a fresh attempt so a
   * transient error does not lock the caller out until expiry.
   */
  fail(error: string, now: IsoDateTime): void {
    if (this.props.status !== "in-progress") {
      throw new ConflictError(`Idempotency key '${this.props.key}' is already ${this.props.status}`);
    }
    this.props.status = "failed";
    this.props.error = error;
    this.props.completedAt = now;
    this.touch();
  }

  /** Re-opens an expired or failed key for a new attempt. */
  reopen(request: unknown, now: IsoDateTime, ttlMs = DEFAULT_IDEMPOTENCY_TTL_MS): void {
    if (this.props.status === "completed" && !this.isExpired(now)) {
      throw new ConflictError(`Idempotency key '${this.props.key}' is still replayable`);
    }
    this.props.requestFingerprint = fingerprint(request);
    this.props.status = "in-progress";
    this.props.response = undefined;
    this.props.error = undefined;
    this.props.reservedAt = now;
    this.props.completedAt = undefined;
    this.props.expiresAt = addMs(now, ttlMs);
    this.props.requestCount += 1;
    this.touch();
  }
}
