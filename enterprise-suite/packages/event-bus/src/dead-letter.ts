/**
 * Dead letters: events a subscriber could not handle within its retry budget.
 * They are kept (never silently dropped) so an operator can inspect, fix and
 * replay them.
 */
import type { EventEnvelope, IsoDateTime, TenantId } from "@enterprise-suite/shared-kernel";
import { newId, nowIso, type Ulid } from "@enterprise-suite/shared-kernel";

export interface DeadLetter {
  readonly id: Ulid;
  readonly event: EventEnvelope;
  readonly subscriptionId: string;
  readonly subscriptionName: string;
  readonly attempts: number;
  readonly error: string;
  readonly errorName: string;
  readonly failedAt: IsoDateTime;
}

export interface DeadLetterSink {
  record(letter: DeadLetter): void | Promise<void>;
}

export interface DeadLetterFilter {
  readonly tenantId?: TenantId;
  readonly subscriptionId?: string;
  readonly eventType?: string;
}

export function toDeadLetter(input: {
  event: EventEnvelope;
  subscriptionId: string;
  subscriptionName: string;
  attempts: number;
  error: unknown;
}): DeadLetter {
  const error = input.error;
  return {
    id: newId("dlq"),
    event: input.event,
    subscriptionId: input.subscriptionId,
    subscriptionName: input.subscriptionName,
    attempts: input.attempts,
    error: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : typeof error,
    failedAt: nowIso(),
  };
}

export class InMemoryDeadLetterQueue implements DeadLetterSink {
  private readonly letters: DeadLetter[] = [];

  constructor(private readonly capacity = 1_000) {}

  record(letter: DeadLetter): void {
    this.letters.push(letter);
    if (this.letters.length > this.capacity) this.letters.shift();
  }

  get size(): number {
    return this.letters.length;
  }

  list(filter: DeadLetterFilter = {}): DeadLetter[] {
    return this.letters.filter(
      (letter) =>
        (filter.tenantId === undefined || letter.event.tenantId === filter.tenantId) &&
        (filter.subscriptionId === undefined || letter.subscriptionId === filter.subscriptionId) &&
        (filter.eventType === undefined || letter.event.eventType === filter.eventType),
    );
  }

  find(id: Ulid): DeadLetter | undefined {
    return this.letters.find((letter) => letter.id === id);
  }

  /** Removes and returns a letter, e.g. right before republishing it. */
  take(id: Ulid): DeadLetter | undefined {
    const index = this.letters.findIndex((letter) => letter.id === id);
    if (index === -1) return undefined;
    return this.letters.splice(index, 1)[0];
  }

  purge(filter: DeadLetterFilter = {}): number {
    const doomed = new Set(this.list(filter).map((letter) => letter.id));
    let removed = 0;
    for (let i = this.letters.length - 1; i >= 0; i--) {
      if (doomed.has(this.letters[i]!.id)) {
        this.letters.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}
