/**
 * Public contracts of the bus. Kept separate from the in-memory
 * implementation so services can depend on the port and swap the transport
 * (NATS, Kafka, Postgres LISTEN/NOTIFY) later.
 */
import type { EventEnvelope, TenantId } from "@enterprise-suite/shared-kernel";
import type { DeadLetterSink } from "./dead-letter.js";
import type { RetryPolicy } from "./retry-policy.js";

export interface DeliveryContext {
  readonly subscriptionId: string;
  readonly subscriptionName: string;
  /** 1-based attempt counter for this event on this subscription. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** True for every attempt after the first. */
  readonly isRedelivery: boolean;
}

export type EventHandler<TPayload = unknown> = (
  event: EventEnvelope<TPayload>,
  context: DeliveryContext,
) => void | Promise<void>;

export type EventFilter = (event: EventEnvelope) => boolean;

export interface SubscribeOptions {
  /** Human-readable name; shows up in metrics, dead letters and logs. */
  readonly name?: string;
  readonly retry?: RetryPolicy;
  /** Deliver only events of this tenant. */
  readonly tenantId?: TenantId;
  /** Extra predicate applied after topic and tenant matching. */
  readonly filter?: EventFilter;
  readonly deadLetter?: DeadLetterSink;
  /** Queue cap; exceeding it drops the oldest queued event and counts it. */
  readonly maxQueueDepth?: number;
  /** Start paused; events queue until `resume()`. */
  readonly startPaused?: boolean;
}

export interface SubscriptionStats {
  readonly received: number;
  readonly delivered: number;
  readonly failedAttempts: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly dropped: number;
  readonly queueDepth: number;
}

export interface Subscription {
  readonly id: string;
  readonly name: string;
  readonly patterns: readonly string[];
  readonly paused: boolean;
  readonly closed: boolean;
  stats(): SubscriptionStats;
  pause(): void;
  resume(): void;
  unsubscribe(): void;
}

export interface PublishOptions {
  /** Skip the publish middleware chain (used by replay tooling). */
  readonly bypassMiddleware?: boolean;
}

export interface EventBus {
  publish<TPayload>(event: EventEnvelope<TPayload>, options?: PublishOptions): Promise<void>;
  publishAll(events: readonly EventEnvelope[], options?: PublishOptions): Promise<void>;
  subscribe<TPayload = unknown>(
    patterns: string | readonly string[],
    handler: EventHandler<TPayload>,
    options?: SubscribeOptions,
  ): Subscription;
  /** Resolves once every queued and in-flight delivery has settled. */
  drain(): Promise<void>;
  close(): Promise<void>;
}
