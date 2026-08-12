/**
 * Application ports: everything the hub needs from the outside world.
 * Infrastructure supplies real implementations; tests supply fakes.
 */
import type { EventEnvelope, IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type {
  AdapterDescriptor,
  AdapterKind,
  HealthCheckResult,
} from "../domain/adapter.js";

export interface Clock {
  now(): IsoDateTime;
}

/** Where the hub publishes: the shared event bus, or a test double. */
export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
  publishAll(events: readonly EventEnvelope[]): Promise<void>;
}

export interface WebhookRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
}

export interface WebhookResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type TransportResult =
  | { readonly kind: "response"; readonly response: WebhookResponse; readonly durationMs: number }
  | {
      readonly kind: "network-error" | "timeout";
      readonly error: string;
      readonly durationMs: number;
    };

/** HTTP client used for webhook delivery; the only I/O the hub performs itself. */
export interface WebhookTransport {
  send(request: WebhookRequest): Promise<TransportResult>;
}

export interface SecretGenerator {
  generate(): string;
}

/**
 * Business handler for an inbound message. Registered per `eventType`
 * pattern; the return value is stored on the inbox record for auditing.
 */
export type InboxHandler = (input: {
  readonly tenantId: TenantId;
  readonly source: string;
  readonly eventType: string;
  readonly messageKey: string;
  readonly payload: unknown;
  readonly headers: Readonly<Record<string, string>>;
}) => Promise<unknown> | unknown;

export interface AdapterMessage {
  readonly key: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface AdapterSendResult {
  readonly accepted: number;
  readonly rejected: readonly { readonly key: string; readonly reason: string }[];
  readonly reference?: string;
  readonly latencyMs: number;
}

export interface AdapterPullResult {
  readonly messages: readonly AdapterMessage[];
  readonly cursor?: string;
  readonly latencyMs: number;
}

/**
 * A driver knows one protocol. Registrations bind a driver to tenant config;
 * the driver itself is stateless with respect to tenants.
 */
export interface AdapterDriver {
  readonly descriptor: AdapterDescriptor;
  test(config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult>;
  send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult>;
  pull(config: Readonly<Record<string, unknown>>, cursor?: string): Promise<AdapterPullResult>;
}

export interface AdapterDriverRegistry {
  register(driver: AdapterDriver): void;
  get(kind: AdapterKind): AdapterDriver;
  has(kind: AdapterKind): boolean;
  descriptors(): AdapterDescriptor[];
}

export interface RelayRunSummary {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly deadLettered: number;
  readonly deliveriesScheduled: number;
  readonly adapterDispatches: number;
}

export interface DispatchSummary {
  readonly attempted: number;
  readonly delivered: number;
  readonly retrying: number;
  readonly deadLettered: number;
}

export interface WorkerIdentity {
  /** Lease owner id, e.g. `relay-1@pod-abc`. */
  readonly name: string;
  readonly leaseMs: number;
}

export interface HubLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface DeliveryIdRef {
  readonly deliveryId: Ulid;
}
