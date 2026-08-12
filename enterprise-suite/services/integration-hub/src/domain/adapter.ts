/**
 * Adapter registry.
 *
 * An *adapter driver* is code that knows how to talk to one kind of external
 * system (HTTP API, SFTP drop, S3 bucket, Kafka topic, flat-file export). An
 * *adapter registration* is a tenant's configured instance of a driver:
 * "ACME's EDI SFTP drop", "the 3PL's inventory API".
 *
 * The domain owns the registration and the config *schema* contract; the
 * drivers themselves live in infrastructure and are stubbed in-memory here,
 * so the registry, validation, health tracking and routing can be exercised
 * end to end without any external system.
 *
 * Lifecycle:
 *   registered ──configure+test ok──> connected ──failed check──> degraded
 *        │                                 │                          │
 *        └──────────── disable ────────────┴──────────────────────────┘
 *   error is set when a check fails while the adapter has never connected.
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
import { IntegrationEventTypes, type AdapterHealthChangedPayload } from "./events.js";

export type AdapterKind = "http" | "sftp" | "s3" | "kafka" | "csv-file" | "email";
export type AdapterDirection = "inbound" | "outbound" | "bidirectional";
export type AdapterStatus = "registered" | "connected" | "degraded" | "error" | "disabled";

export type ConfigFieldType = "string" | "number" | "boolean" | "enum" | "secret-ref" | "url";

export interface ConfigField {
  readonly name: string;
  readonly type: ConfigFieldType;
  readonly required: boolean;
  readonly description?: string;
  readonly default?: unknown;
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
}

export interface AdapterCapabilities {
  readonly supportsPush: boolean;
  readonly supportsPull: boolean;
  readonly supportsBatch: boolean;
  readonly maxBatchSize: number;
}

export interface AdapterDescriptor {
  readonly kind: AdapterKind;
  readonly displayName: string;
  readonly direction: AdapterDirection;
  readonly capabilities: AdapterCapabilities;
  readonly configSchema: readonly ConfigField[];
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly message?: string;
  readonly checkedAt: IsoDateTime;
}

interface AdapterRegistrationProps {
  name: string;
  kind: AdapterKind;
  direction: AdapterDirection;
  config: Record<string, unknown>;
  /** Reference into the secret store; raw credentials never live here. */
  credentialsRef?: string;
  status: AdapterStatus;
  capabilities: AdapterCapabilities;
  lastHealth?: HealthCheckResult;
  consecutiveFailures: number;
  messagesSent: number;
  messagesPulled: number;
  lastUsedAt?: IsoDateTime;
  disabledReason?: string;
}

/**
 * Validates config against a driver's declared schema, applying defaults and
 * rejecting unknown keys (a typo in a config key must not silently disable a
 * setting).
 */
export function validateAdapterConfig(
  schema: readonly ConfigField[],
  config: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Map(schema.map((field) => [field.name, field]));
  for (const key of Object.keys(config)) {
    if (!known.has(key)) {
      throw new DomainError(
        `unknown config key '${key}'; expected one of ${[...known.keys()].join(", ")}`,
        "VALIDATION",
      );
    }
  }
  const result: Record<string, unknown> = {};
  for (const field of schema) {
    const raw = config[field.name] ?? field.default;
    if (raw === undefined || raw === null) {
      if (field.required) throw new DomainError(`config '${field.name}' is required`, "VALIDATION");
      continue;
    }
    result[field.name] = coerceField(field, raw);
  }
  return result;
}

function coerceField(field: ConfigField, raw: unknown): unknown {
  switch (field.type) {
    case "string":
    case "secret-ref": {
      if (typeof raw !== "string" || raw.trim() === "") {
        throw new DomainError(`config '${field.name}' must be a non-empty string`, "VALIDATION");
      }
      if (field.type === "secret-ref" && !/^secret:\/\/[a-z0-9/_-]+$/i.test(raw)) {
        throw new DomainError(
          `config '${field.name}' must be a secret reference like 'secret://path/to/key'`,
          "VALIDATION",
        );
      }
      return raw;
    }
    case "url": {
      if (typeof raw !== "string") {
        throw new DomainError(`config '${field.name}' must be a URL string`, "VALIDATION");
      }
      try {
        new URL(raw);
      } catch {
        throw new DomainError(`config '${field.name}' is not a valid URL`, "VALIDATION");
      }
      return raw;
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new DomainError(`config '${field.name}' must be a number`, "VALIDATION");
      }
      if (field.min !== undefined && raw < field.min) {
        throw new DomainError(`config '${field.name}' must be >= ${field.min}`, "VALIDATION");
      }
      if (field.max !== undefined && raw > field.max) {
        throw new DomainError(`config '${field.name}' must be <= ${field.max}`, "VALIDATION");
      }
      return raw;
    }
    case "boolean": {
      if (typeof raw !== "boolean") {
        throw new DomainError(`config '${field.name}' must be a boolean`, "VALIDATION");
      }
      return raw;
    }
    case "enum": {
      if (typeof raw !== "string" || !(field.values ?? []).includes(raw)) {
        throw new DomainError(
          `config '${field.name}' must be one of: ${(field.values ?? []).join(", ")}`,
          "VALIDATION",
        );
      }
      return raw;
    }
  }
}

export const ADAPTER_DEGRADE_THRESHOLD = 3;

export class AdapterRegistration extends AggregateRoot<AdapterRegistrationProps> {
  private constructor(
    tenantId: TenantId,
    props: AdapterRegistrationProps,
    existing?: Partial<EntityProps>,
  ) {
    super(tenantId, props, existing);
  }

  static register(input: {
    tenantId: TenantId;
    name: string;
    descriptor: AdapterDescriptor;
    config: Record<string, unknown>;
    credentialsRef?: string;
    direction?: AdapterDirection;
  }): AdapterRegistration {
    if (!input.name.trim()) throw new DomainError("name is required", "VALIDATION");
    const direction = input.direction ?? input.descriptor.direction;
    if (
      input.descriptor.direction !== "bidirectional" &&
      direction !== input.descriptor.direction
    ) {
      throw new DomainError(
        `driver '${input.descriptor.kind}' only supports direction '${input.descriptor.direction}'`,
        "VALIDATION",
      );
    }
    if (input.credentialsRef && !/^secret:\/\/[a-z0-9/_-]+$/i.test(input.credentialsRef)) {
      throw new DomainError("credentialsRef must look like 'secret://path/to/key'", "VALIDATION");
    }

    const adapter = new AdapterRegistration(input.tenantId, {
      name: input.name.trim(),
      kind: input.descriptor.kind,
      direction,
      config: validateAdapterConfig(input.descriptor.configSchema, input.config),
      credentialsRef: input.credentialsRef,
      status: "registered",
      capabilities: input.descriptor.capabilities,
      consecutiveFailures: 0,
      messagesSent: 0,
      messagesPulled: 0,
    });
    adapter.raise(
      envelope({
        eventType: IntegrationEventTypes.AdapterRegistered,
        aggregateType: "AdapterRegistration",
        aggregateId: adapter.id,
        tenantId: input.tenantId,
        payload: { name: adapter.props.name, kind: adapter.props.kind, direction },
      }),
    );
    return adapter;
  }

  static rehydrate(
    tenantId: TenantId,
    props: AdapterRegistrationProps,
    existing: Partial<EntityProps>,
  ): AdapterRegistration {
    return new AdapterRegistration(tenantId, props, existing);
  }

  get name(): string { return this.props.name; }
  get kind(): AdapterKind { return this.props.kind; }
  get direction(): AdapterDirection { return this.props.direction; }
  get config(): Readonly<Record<string, unknown>> { return this.props.config; }
  get credentialsRef(): string | undefined { return this.props.credentialsRef; }
  get status(): AdapterStatus { return this.props.status; }
  get capabilities(): AdapterCapabilities { return this.props.capabilities; }
  get lastHealth(): HealthCheckResult | undefined { return this.props.lastHealth; }
  get consecutiveFailures(): number { return this.props.consecutiveFailures; }
  get messagesSent(): number { return this.props.messagesSent; }
  get messagesPulled(): number { return this.props.messagesPulled; }

  get isUsable(): boolean {
    return this.props.status === "registered" || this.props.status === "connected" || this.props.status === "degraded";
  }

  get canSend(): boolean {
    return this.isUsable && this.props.direction !== "inbound" && this.props.capabilities.supportsPush;
  }

  get canPull(): boolean {
    return this.isUsable && this.props.direction !== "outbound" && this.props.capabilities.supportsPull;
  }

  configure(descriptor: AdapterDescriptor, config: Record<string, unknown>): void {
    if (this.props.status === "disabled") {
      throw new ConflictError("Enable the adapter before changing its configuration");
    }
    this.props.config = validateAdapterConfig(descriptor.configSchema, config);
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.AdapterConfigured,
        aggregateType: "AdapterRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, kind: this.props.kind, keys: Object.keys(this.props.config) },
      }),
    );
  }

  recordHealth(result: HealthCheckResult): { statusChanged: boolean } {
    if (this.props.status === "disabled") {
      throw new ConflictError("Disabled adapters are not health-checked");
    }
    const previous = this.props.status;
    this.props.lastHealth = result;
    if (result.healthy) {
      this.props.consecutiveFailures = 0;
      this.props.status = "connected";
    } else {
      this.props.consecutiveFailures += 1;
      // One bad check is a blip (degraded, still routable); a streak is an outage.
      this.props.status =
        this.props.consecutiveFailures >= ADAPTER_DEGRADE_THRESHOLD ? "error" : "degraded";
    }
    const statusChanged = previous !== this.props.status;
    if (statusChanged) {
      const payload: AdapterHealthChangedPayload = {
        adapterId: this.id,
        adapterKind: this.props.kind,
        healthy: result.healthy,
        previousStatus: previous,
        status: this.props.status,
        message: result.message,
        latencyMs: result.latencyMs,
      };
      this.raise(
        envelope({
          eventType: IntegrationEventTypes.AdapterHealthChanged,
          aggregateType: "AdapterRegistration",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload,
        }),
      );
    } else {
      this.touch();
    }
    return { statusChanged };
  }

  recordSend(count: number, now: IsoDateTime): void {
    if (!this.canSend) {
      throw new ConflictError(
        `Adapter '${this.props.name}' cannot send (status=${this.props.status}, direction=${this.props.direction})`,
      );
    }
    if (count > this.props.capabilities.maxBatchSize) {
      throw new DomainError(
        `batch of ${count} exceeds the driver limit of ${this.props.capabilities.maxBatchSize}`,
        "VALIDATION",
      );
    }
    this.props.messagesSent += count;
    this.props.lastUsedAt = now;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.AdapterMessagesSent,
        aggregateType: "AdapterRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, kind: this.props.kind, count },
      }),
    );
  }

  recordPull(count: number, now: IsoDateTime): void {
    if (!this.canPull) {
      throw new ConflictError(
        `Adapter '${this.props.name}' cannot pull (status=${this.props.status}, direction=${this.props.direction})`,
      );
    }
    this.props.messagesPulled += count;
    this.props.lastUsedAt = now;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.AdapterMessagesPulled,
        aggregateType: "AdapterRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, kind: this.props.kind, count },
      }),
    );
  }

  disable(reason: string): void {
    if (!reason.trim()) throw new DomainError("reason is required", "VALIDATION");
    if (this.props.status === "disabled") return;
    this.props.status = "disabled";
    this.props.disabledReason = reason.trim();
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.AdapterDisabled,
        aggregateType: "AdapterRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, kind: this.props.kind, reason: reason.trim() },
      }),
    );
  }

  enable(): void {
    if (this.props.status !== "disabled") {
      throw new ConflictError(`Only disabled adapters can be enabled (status=${this.props.status})`);
    }
    this.props.status = "registered";
    this.props.disabledReason = undefined;
    this.props.consecutiveFailures = 0;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.AdapterEnabled,
        aggregateType: "AdapterRegistration",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, kind: this.props.kind },
      }),
    );
  }
}
