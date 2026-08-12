/**
 * Event catalog for the Integration Hub bounded context.
 *
 * The hub is itself an event producer: operators build dashboards and alerts
 * from these (delivery failure rates, dead-letter growth, adapters going
 * unhealthy), and they are re-published on the bus like any other domain
 * event.
 */
import type { Ulid } from "@enterprise-suite/shared-kernel";

export const IntegrationEventTypes = {
  // Outbox relay
  OutboxMessageEnqueued: "integration.outbox.enqueued",
  OutboxMessagePublished: "integration.outbox.published",
  OutboxMessageFailed: "integration.outbox.failed",
  OutboxMessageDeadLettered: "integration.outbox.dead-lettered",
  OutboxMessageReplayed: "integration.outbox.replayed",

  // Inbox
  InboxMessageReceived: "integration.inbox.received",
  InboxDuplicateIgnored: "integration.inbox.duplicate-ignored",
  InboxMessageProcessed: "integration.inbox.processed",
  InboxMessageFailed: "integration.inbox.failed",
  InboxMessageDiscarded: "integration.inbox.discarded",

  // Idempotency
  IdempotencyKeyReserved: "integration.idempotency.reserved",
  IdempotencyKeyCompleted: "integration.idempotency.completed",
  IdempotencyReplayServed: "integration.idempotency.replay-served",
  IdempotencyConflictDetected: "integration.idempotency.conflict",

  // Webhook subscriptions
  WebhookSubscriptionCreated: "integration.webhook.subscription-created",
  WebhookSubscriptionUpdated: "integration.webhook.subscription-updated",
  WebhookSubscriptionPaused: "integration.webhook.subscription-paused",
  WebhookSubscriptionResumed: "integration.webhook.subscription-resumed",
  WebhookSubscriptionDisabled: "integration.webhook.subscription-disabled",
  WebhookSubscriptionAutoDisabled: "integration.webhook.subscription-auto-disabled",
  WebhookSecretRotated: "integration.webhook.secret-rotated",

  // Webhook deliveries
  WebhookDeliveryScheduled: "integration.webhook.delivery-scheduled",
  WebhookDeliverySucceeded: "integration.webhook.delivery-succeeded",
  WebhookDeliveryRetryScheduled: "integration.webhook.delivery-retry-scheduled",
  WebhookDeliveryDeadLettered: "integration.webhook.delivery-dead-lettered",
  WebhookDeliveryCancelled: "integration.webhook.delivery-cancelled",

  // Adapters
  AdapterRegistered: "integration.adapter.registered",
  AdapterConfigured: "integration.adapter.configured",
  AdapterHealthChanged: "integration.adapter.health-changed",
  AdapterEnabled: "integration.adapter.enabled",
  AdapterDisabled: "integration.adapter.disabled",
  AdapterMessagesSent: "integration.adapter.messages-sent",
  AdapterMessagesPulled: "integration.adapter.messages-pulled",

  // Routing
  RouteRuleCreated: "integration.route.created",
  RouteRuleUpdated: "integration.route.updated",
  RouteRuleEnabled: "integration.route.enabled",
  RouteRuleDisabled: "integration.route.disabled",
} as const;

export type IntegrationEventType =
  (typeof IntegrationEventTypes)[keyof typeof IntegrationEventTypes];

export interface OutboxMessageEnqueuedPayload {
  readonly source: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly partitionKey: string;
}

export interface OutboxMessagePublishedPayload {
  readonly source: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly attempts: number;
  readonly latencyMs: number;
}

export interface OutboxMessageFailedPayload {
  readonly source: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly attempts: number;
  readonly error: string;
  readonly nextAttemptAt?: string;
}

export interface InboxMessageReceivedPayload {
  readonly source: string;
  readonly messageKey: string;
  readonly eventType: string;
  readonly checksum: string;
}

export interface InboxDuplicateIgnoredPayload {
  readonly source: string;
  readonly messageKey: string;
  readonly originalId: Ulid;
  readonly sameChecksum: boolean;
}

export interface WebhookDeliveryScheduledPayload {
  readonly subscriptionId: Ulid;
  readonly eventId: string;
  readonly eventType: string;
  readonly endpointUrl: string;
}

export interface WebhookDeliveryOutcomePayload {
  readonly subscriptionId: Ulid;
  readonly deliveryId: Ulid;
  readonly eventType: string;
  readonly attempts: number;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly nextAttemptAt?: string;
}

export interface WebhookSubscriptionAutoDisabledPayload {
  readonly subscriptionId: Ulid;
  readonly endpointUrl: string;
  readonly consecutiveFailures: number;
  readonly threshold: number;
}

export interface AdapterHealthChangedPayload {
  readonly adapterId: Ulid;
  readonly adapterKind: string;
  readonly healthy: boolean;
  readonly previousStatus: string;
  readonly status: string;
  readonly message?: string;
  readonly latencyMs?: number;
}
