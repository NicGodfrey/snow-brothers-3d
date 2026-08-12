/**
 * In-process publish/subscribe bus.
 *
 * Semantics:
 *  - `publish` resolves once the event has passed the middleware chain and
 *    has been queued for every matching subscription. Delivery itself is
 *    asynchronous; `drain()` waits for it.
 *  - each subscription has its own FIFO queue processed one event at a time,
 *    so a subscriber observes events in publish order.
 *  - a throwing handler is retried according to the subscription's retry
 *    policy; once the budget is spent the event goes to a dead-letter sink.
 *  - one slow or failing subscriber never blocks another: queues are pumped
 *    independently.
 */
import { newId, type EventEnvelope } from "@enterprise-suite/shared-kernel";
import {
  InMemoryDeadLetterQueue,
  toDeadLetter,
  type DeadLetterSink,
} from "./dead-letter.js";
import { MetricsCollector, type BusMetricsSnapshot } from "./metrics.js";
import { composeMiddleware, type PublishMiddleware } from "./middleware.js";
import {
  DEFAULT_RETRY_POLICY,
  nextDelayMs,
  shouldRetry,
  validateRetryPolicy,
  type RetryPolicy,
} from "./retry-policy.js";
import { TimerScheduler, type Scheduler } from "./scheduler.js";
import { parseTopicPattern, TopicRouter } from "./topic-pattern.js";
import type {
  DeliveryContext,
  EventBus,
  EventHandler,
  PublishOptions,
  SubscribeOptions,
  Subscription,
  SubscriptionStats,
} from "./types.js";

export interface EventBusOptions {
  readonly scheduler?: Scheduler;
  readonly retry?: RetryPolicy;
  readonly deadLetter?: DeadLetterSink;
  readonly middleware?: readonly PublishMiddleware[];
  /** Called for every failed attempt, including ones that will be retried. */
  readonly onError?: (error: unknown, context: DeliveryContext, event: EventEnvelope) => void;
  readonly defaultMaxQueueDepth?: number;
}

class SubscriptionRecord implements Subscription {
  readonly id: string;
  readonly name: string;
  readonly patterns: readonly string[];
  readonly queue: EventEnvelope[] = [];
  readonly retry: RetryPolicy;
  readonly maxQueueDepth: number;

  paused: boolean;
  closed = false;
  pumping = false;

  received = 0;
  delivered = 0;
  failedAttempts = 0;
  retried = 0;
  deadLettered = 0;
  dropped = 0;

  constructor(
    patterns: readonly string[],
    readonly handler: EventHandler<never>,
    readonly options: SubscribeOptions,
    defaults: { retry: RetryPolicy; maxQueueDepth: number },
    private readonly onUnsubscribe: (record: SubscriptionRecord) => void,
    private readonly onResume: (record: SubscriptionRecord) => void,
  ) {
    this.id = newId("sub");
    this.name = options.name ?? patterns.join("|");
    this.patterns = patterns;
    this.retry = options.retry ? validateRetryPolicy(options.retry) : defaults.retry;
    this.maxQueueDepth = options.maxQueueDepth ?? defaults.maxQueueDepth;
    this.paused = options.startPaused === true;
  }

  accepts(event: EventEnvelope): boolean {
    if (this.options.tenantId !== undefined && event.tenantId !== this.options.tenantId) return false;
    if (this.options.filter && !this.options.filter(event)) return false;
    return true;
  }

  enqueue(event: EventEnvelope): void {
    this.received++;
    this.queue.push(event);
    while (this.queue.length > this.maxQueueDepth) {
      this.queue.shift();
      this.dropped++;
    }
  }

  stats(): SubscriptionStats {
    return {
      received: this.received,
      delivered: this.delivered,
      failedAttempts: this.failedAttempts,
      retried: this.retried,
      deadLettered: this.deadLettered,
      dropped: this.dropped,
      queueDepth: this.queue.length,
    };
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.onResume(this);
  }

  unsubscribe(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    this.onUnsubscribe(this);
  }
}

export class InMemoryEventBus implements EventBus {
  private readonly router = new TopicRouter<SubscriptionRecord>();
  private readonly records = new Set<SubscriptionRecord>();
  private readonly scheduler: Scheduler;
  private readonly defaultRetry: RetryPolicy;
  private readonly defaultDeadLetter: DeadLetterSink;
  private readonly middlewares: PublishMiddleware[];
  private readonly onError?: EventBusOptions["onError"];
  private readonly defaultMaxQueueDepth: number;
  private readonly collector = new MetricsCollector();
  private readonly idleWaiters: (() => void)[] = [];
  private inFlight = 0;
  private closed = false;

  /** Default sink, readable when the caller did not supply their own. */
  readonly deadLetters = new InMemoryDeadLetterQueue();

  constructor(options: EventBusOptions = {}) {
    this.scheduler = options.scheduler ?? new TimerScheduler();
    this.defaultRetry = validateRetryPolicy(options.retry ?? DEFAULT_RETRY_POLICY);
    this.defaultDeadLetter = options.deadLetter ?? this.deadLetters;
    this.middlewares = [...(options.middleware ?? [])];
    this.onError = options.onError;
    this.defaultMaxQueueDepth = options.defaultMaxQueueDepth ?? 10_000;
  }

  /** Appends a publish middleware; order of registration is order of execution. */
  use(middleware: PublishMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  get subscriptionCount(): number {
    return this.records.size;
  }

  metrics(): BusMetricsSnapshot {
    this.collector.setSubscriptions(this.records.size);
    return this.collector.snapshot();
  }

  subscribe<TPayload = unknown>(
    patterns: string | readonly string[],
    handler: EventHandler<TPayload>,
    options: SubscribeOptions = {},
  ): Subscription {
    if (this.closed) throw new Error("Cannot subscribe on a closed event bus");
    const list = typeof patterns === "string" ? [patterns] : [...patterns];
    if (list.length === 0) throw new Error("subscribe requires at least one topic pattern");
    for (const pattern of list) parseTopicPattern(pattern);

    const record = new SubscriptionRecord(
      list,
      handler as EventHandler<never>,
      options,
      { retry: this.defaultRetry, maxQueueDepth: this.defaultMaxQueueDepth },
      (r) => {
        this.router.removeValue(r);
        this.records.delete(r);
      },
      (r) => {
        void this.pump(r);
      },
    );
    for (const pattern of list) this.router.add(pattern, record);
    this.records.add(record);
    return record;
  }

  /** Convenience: resolves with the first matching event (or rejects on timeout). */
  waitFor(pattern: string, options: { timeoutMs?: number; filter?: (e: EventEnvelope) => boolean } = {}):
    Promise<EventEnvelope> {
    return new Promise((resolve, reject) => {
      const subscription = this.subscribe(
        pattern,
        (event) => {
          subscription.unsubscribe();
          cancelTimeout?.();
          resolve(event as EventEnvelope);
        },
        { name: `wait-for:${pattern}`, filter: options.filter },
      );
      const timeoutMs = options.timeoutMs;
      const cancelTimeout =
        timeoutMs === undefined
          ? undefined
          : this.scheduler.schedule(timeoutMs, () => {
              subscription.unsubscribe();
              reject(new Error(`Timed out after ${timeoutMs}ms waiting for '${pattern}'`));
            });
    });
  }

  async publish<TPayload>(event: EventEnvelope<TPayload>, options: PublishOptions = {}): Promise<void> {
    if (this.closed) throw new Error("Cannot publish on a closed event bus");
    const dispatch = composeMiddleware(
      options.bypassMiddleware ? [] : this.middlewares,
      async (finalEvent) => {
        this.route(finalEvent);
      },
    );
    await dispatch(event as EventEnvelope);
  }

  async publishAll(events: readonly EventEnvelope[], options: PublishOptions = {}): Promise<void> {
    for (const event of events) await this.publish(event, options);
  }

  private route(event: EventEnvelope): void {
    this.collector.recordPublished(event.eventType);
    for (const record of this.router.match(event.eventType)) {
      if (record.closed || !record.accepts(event)) continue;
      const before = record.dropped;
      record.enqueue(event);
      if (record.dropped > before) this.collector.recordDropped();
      void this.pump(record);
    }
  }

  private async pump(record: SubscriptionRecord): Promise<void> {
    if (record.pumping || record.paused || record.closed) return;
    record.pumping = true;
    this.inFlight++;
    try {
      while (record.queue.length > 0 && !record.paused && !record.closed) {
        const event = record.queue.shift()!;
        await this.deliver(record, event);
      }
    } finally {
      record.pumping = false;
      this.inFlight--;
      this.settleIdle();
    }
  }

  private async deliver(record: SubscriptionRecord, event: EventEnvelope): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const context: DeliveryContext = {
        subscriptionId: record.id,
        subscriptionName: record.name,
        attempt,
        maxAttempts: record.retry.maxAttempts,
        isRedelivery: attempt > 1,
      };
      try {
        await record.handler(event as never, context);
        record.delivered++;
        this.collector.recordDelivered(record.name);
        return;
      } catch (error) {
        record.failedAttempts++;
        this.collector.recordFailedAttempt();
        this.onError?.(error, context, event);

        if (!shouldRetry(record.retry, attempt) || record.closed) {
          record.deadLettered++;
          this.collector.recordDeadLetter();
          const sink = record.options.deadLetter ?? this.defaultDeadLetter;
          await sink.record(
            toDeadLetter({
              event,
              subscriptionId: record.id,
              subscriptionName: record.name,
              attempts: attempt,
              error,
            }),
          );
          return;
        }
        record.retried++;
        this.collector.recordRetry();
        await this.sleep(nextDelayMs(record.retry, attempt));
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.scheduler.schedule(ms, resolve);
    });
  }

  private settleIdle(): void {
    if (!this.isIdle()) return;
    while (this.idleWaiters.length > 0) this.idleWaiters.shift()!();
  }

  private isIdle(): boolean {
    if (this.inFlight > 0) return false;
    for (const record of this.records) {
      if (!record.paused && !record.closed && record.queue.length > 0) return false;
    }
    return true;
  }

  /**
   * Waits until no subscription has queued or in-flight work. Deliveries that
   * are sleeping between retries count as in-flight, so with a
   * {@link ManualScheduler} advance virtual time before awaiting this.
   */
  async drain(): Promise<void> {
    while (!this.isIdle()) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const record of [...this.records]) record.unsubscribe();
    this.settleIdle();
  }
}
