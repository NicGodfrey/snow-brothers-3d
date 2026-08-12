/**
 * The relay: the loop that turns stored outbox rows into published events.
 *
 * For each claimed message it
 *   1. publishes the envelope on the shared bus (in-process consumers),
 *   2. schedules webhook deliveries for every matching subscription,
 *   3. applies route rules — adapter pushes, and bus re-publication under a
 *      translated topic for anti-corruption between contexts.
 *
 * Any failure in those steps fails the *message*, not the loop: it goes back
 * to pending with backoff and is retried, or dead-letters once the budget is
 * spent. Because step 1 may already have happened when step 2 fails,
 * consumers must be idempotent — which is exactly what the inbox provides.
 */
import { envelope, type EventEnvelope, type TenantId } from "@enterprise-suite/shared-kernel";
import type { OutboxMessage } from "../domain/outbox.js";
import type { AdapterService } from "./adapter-service.js";
import type { DeliveryService } from "./delivery-service.js";
import type { OutboxService } from "./outbox-service.js";
import type { RoutingService } from "./routing-service.js";
import type { Clock, EventPublisher, HubLogger, RelayRunSummary, WorkerIdentity } from "./ports.js";

export interface RelayOptions {
  readonly limit?: number;
  readonly tenantId?: TenantId;
  readonly source?: string;
}

export class RelayService {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly publisher: EventPublisher,
    private readonly routing: RoutingService,
    private readonly deliveries: DeliveryService,
    private readonly adapters: AdapterService,
    private readonly clock: Clock,
    private readonly worker: WorkerIdentity = { name: "relay-1", leaseMs: 30_000 },
    private readonly logger?: HubLogger,
  ) {}

  async runOnce(options: RelayOptions = {}): Promise<RelayRunSummary> {
    const claimed = await this.outboxService.claim(this.worker, options.limit ?? 25, {
      tenantId: options.tenantId,
      source: options.source,
    });

    let published = 0;
    let failed = 0;
    let deadLettered = 0;
    let deliveriesScheduled = 0;
    let adapterDispatches = 0;

    for (const message of claimed) {
      try {
        const result = await this.dispatch(message);
        deliveriesScheduled += result.deliveriesScheduled;
        adapterDispatches += result.adapterDispatches;
        await this.outboxService.markPublished(this.worker, message);
        published++;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.outboxService.markFailed(this.worker, message, reason);
        if (message.status === "dead-lettered") deadLettered++;
        else failed++;
        this.logger?.error("relay dispatch failed", {
          messageId: message.id,
          eventType: message.eventType,
          attempts: message.attempts,
          error: reason,
        });
      }
    }

    return { claimed: claimed.length, published, failed, deadLettered, deliveriesScheduled, adapterDispatches };
  }

  /** Drains the queue until nothing is due, bounded to avoid a hot loop. */
  async runUntilIdle(options: RelayOptions & { maxRounds?: number } = {}): Promise<RelayRunSummary> {
    const totals = {
      claimed: 0, published: 0, failed: 0, deadLettered: 0, deliveriesScheduled: 0, adapterDispatches: 0,
    };
    const maxRounds = options.maxRounds ?? 20;
    for (let round = 0; round < maxRounds; round++) {
      const summary = await this.runOnce(options);
      totals.claimed += summary.claimed;
      totals.published += summary.published;
      totals.failed += summary.failed;
      totals.deadLettered += summary.deadLettered;
      totals.deliveriesScheduled += summary.deliveriesScheduled;
      totals.adapterDispatches += summary.adapterDispatches;
      if (summary.claimed === 0) break;
    }
    return totals;
  }

  private async dispatch(
    message: OutboxMessage,
  ): Promise<{ deliveriesScheduled: number; adapterDispatches: number }> {
    const event = message.event;
    await this.publisher.publish(event);

    const routes = await this.routing.resolve(event);
    const webhookTargets = routes
      .filter((route) => route.destination.type === "webhook")
      .map((route) => (route.destination as { subscriptionId: EventEnvelope["aggregateId"] }).subscriptionId);

    const scheduled = await this.deliveries.scheduleForEvent(event, {
      extraSubscriptionIds: webhookTargets,
    });

    let adapterDispatches = 0;
    for (const route of routes) {
      if (route.destination.type === "adapter") {
        await this.adapters.sendById(event.tenantId, route.destination.adapterId, [
          {
            key: `${String(event.eventId)}:${String(route.rule.id)}`,
            eventType: event.eventType,
            payload: route.payload,
            headers: { "x-es-route": route.rule.name },
          },
        ]);
        adapterDispatches++;
      } else if (route.destination.type === "bus") {
        // Translated re-publication: a new envelope so the original event id
        // stays the causation anchor.
        await this.publisher.publish(
          envelope({
            eventType: route.destination.topic,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            tenantId: event.tenantId,
            payload: route.payload,
            correlationId: event.correlationId ?? event.eventId,
            causationId: event.eventId,
          }),
        );
      }
    }

    return { deliveriesScheduled: scheduled.length, adapterDispatches };
  }
}
