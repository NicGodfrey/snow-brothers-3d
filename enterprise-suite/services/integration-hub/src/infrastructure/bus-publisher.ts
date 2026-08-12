/**
 * Bridges the hub's `EventPublisher` port onto the shared event bus, and
 * offers a recording double for tests.
 */
import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { EventBus } from "@enterprise-suite/event-bus";
import type { EventPublisher } from "../application/ports.js";

export class BusEventPublisher implements EventPublisher {
  constructor(private readonly bus: EventBus) {}

  async publish(event: EventEnvelope): Promise<void> {
    await this.bus.publish(event);
  }

  async publishAll(events: readonly EventEnvelope[]): Promise<void> {
    await this.bus.publishAll(events);
  }
}

/** Captures published events without a bus; also useful as a null publisher. */
export class RecordingEventPublisher implements EventPublisher {
  readonly events: EventEnvelope[] = [];

  async publish(event: EventEnvelope): Promise<void> {
    this.events.push(event);
  }

  async publishAll(events: readonly EventEnvelope[]): Promise<void> {
    this.events.push(...events);
  }

  types(): string[] {
    return this.events.map((event) => event.eventType);
  }

  ofType(eventType: string): EventEnvelope[] {
    return this.events.filter((event) => event.eventType === eventType);
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** Fans out to several publishers, e.g. bus + audit recorder. */
export class CompositeEventPublisher implements EventPublisher {
  constructor(private readonly publishers: readonly EventPublisher[]) {}

  async publish(event: EventEnvelope): Promise<void> {
    for (const publisher of this.publishers) await publisher.publish(event);
  }

  async publishAll(events: readonly EventEnvelope[]): Promise<void> {
    for (const publisher of this.publishers) await publisher.publishAll(events);
  }
}
