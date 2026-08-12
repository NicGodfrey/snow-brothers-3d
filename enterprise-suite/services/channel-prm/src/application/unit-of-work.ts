import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { OutboxPort } from "./ports.js";

export interface EventSource {
  pullEvents(): EventEnvelope[];
}

/**
 * Collects the events raised by every aggregate a use case touched and hands
 * them to the outbox in one call, after the repositories have been written.
 *
 * Conflict resolution is the reason this exists: one command mutates the case
 * and both registrations, and a consumer must never see the claimant's
 * approval without the incumbent's revocation.
 */
export class Publisher {
  constructor(private readonly outbox: OutboxPort) {}

  async publish(...sources: readonly (EventSource | undefined)[]): Promise<void> {
    const events: EventEnvelope[] = [];
    for (const source of sources) {
      if (source) events.push(...source.pullEvents());
    }
    if (events.length > 0) await this.outbox.publish(events);
  }
}
