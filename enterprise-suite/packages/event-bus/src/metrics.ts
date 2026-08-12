/**
 * Counters exposed by the bus. Deliberately tiny: enough for the
 * integration-hub `/metrics` endpoint and for assertions in tests, without
 * pulling in a metrics runtime.
 */

export interface BusMetricsSnapshot {
  readonly published: number;
  readonly delivered: number;
  readonly failedAttempts: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly dropped: number;
  readonly subscriptions: number;
  readonly publishedByType: Readonly<Record<string, number>>;
  readonly deliveredBySubscription: Readonly<Record<string, number>>;
}

export class MetricsCollector {
  private published = 0;
  private delivered = 0;
  private failedAttempts = 0;
  private retried = 0;
  private deadLettered = 0;
  private dropped = 0;
  private subscriptions = 0;
  private readonly publishedByType = new Map<string, number>();
  private readonly deliveredBySubscription = new Map<string, number>();

  recordPublished(eventType: string): void {
    this.published++;
    this.publishedByType.set(eventType, (this.publishedByType.get(eventType) ?? 0) + 1);
  }

  recordDelivered(subscriptionName: string): void {
    this.delivered++;
    this.deliveredBySubscription.set(
      subscriptionName,
      (this.deliveredBySubscription.get(subscriptionName) ?? 0) + 1,
    );
  }

  recordFailedAttempt(): void {
    this.failedAttempts++;
  }

  recordRetry(): void {
    this.retried++;
  }

  recordDeadLetter(): void {
    this.deadLettered++;
  }

  recordDropped(): void {
    this.dropped++;
  }

  setSubscriptions(count: number): void {
    this.subscriptions = count;
  }

  snapshot(): BusMetricsSnapshot {
    return {
      published: this.published,
      delivered: this.delivered,
      failedAttempts: this.failedAttempts,
      retried: this.retried,
      deadLettered: this.deadLettered,
      dropped: this.dropped,
      subscriptions: this.subscriptions,
      publishedByType: Object.fromEntries(this.publishedByType),
      deliveredBySubscription: Object.fromEntries(this.deliveredBySubscription),
    };
  }

  reset(): void {
    this.published = 0;
    this.delivered = 0;
    this.failedAttempts = 0;
    this.retried = 0;
    this.deadLettered = 0;
    this.dropped = 0;
    this.publishedByType.clear();
    this.deliveredBySubscription.clear();
  }
}
