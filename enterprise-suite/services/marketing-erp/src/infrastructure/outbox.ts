import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { OutboxPort } from "../application/ports.js";

export type OutboxHandler = (event: EventEnvelope) => void;

interface OutboxEntry {
  readonly event: EventEnvelope;
  dispatched: boolean;
}

/**
 * In-memory transactional outbox. Services publish aggregate events here;
 * `dispatchPending` relays them to subscribed handlers exactly once, in
 * publish order — the same contract a Postgres outbox table + relay would
 * honor, so swapping the implementation later does not change semantics.
 */
export class InMemoryOutbox implements OutboxPort {
  private readonly entries: OutboxEntry[] = [];
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private readonly wildcardHandlers: OutboxHandler[] = [];

  publish(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      this.entries.push({ event, dispatched: false });
    }
  }

  /** Subscribe to a specific event type, or "*" for everything. */
  subscribe(eventType: string, handler: OutboxHandler): void {
    if (eventType === "*") {
      this.wildcardHandlers.push(handler);
      return;
    }
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /** Relays undispatched events in order. Returns how many were dispatched. */
  dispatchPending(): number {
    let dispatched = 0;
    for (const entry of this.entries) {
      if (entry.dispatched) continue;
      for (const handler of this.handlers.get(entry.event.eventType) ?? []) {
        handler(entry.event);
      }
      for (const handler of this.wildcardHandlers) {
        handler(entry.event);
      }
      entry.dispatched = true;
      dispatched += 1;
    }
    return dispatched;
  }

  pending(): EventEnvelope[] {
    return this.entries.filter((e) => !e.dispatched).map((e) => e.event);
  }

  all(): EventEnvelope[] {
    return this.entries.map((e) => e.event);
  }

  ofType(eventType: string): EventEnvelope[] {
    return this.entries.filter((e) => e.event.eventType === eventType).map((e) => e.event);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
