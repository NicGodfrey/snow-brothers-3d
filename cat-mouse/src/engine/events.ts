import type { EventBusLike, EventHandler } from './types';

interface Subscription {
  handler: EventHandler<never>;
  once: boolean;
  dead: boolean;
}

/**
 * Synchronous topic bus. Handlers added while a topic is dispatching run on the
 * next emit, which keeps recursive gameplay reactions from corrupting the walk.
 */
export class EventBus implements EventBusLike {
  private readonly topics = new Map<string, Subscription[]>();
  private readonly dispatching = new Set<string>();
  private pending: { topic: string; sub: Subscription }[] = [];
  private drainedCount = 0;

  get drained(): number {
    return this.drainedCount;
  }

  emit<T>(topic: string, payload: T): void {
    const subs = this.topics.get(topic);
    this.drainedCount += 1;
    if (!subs || subs.length === 0) return;
    this.dispatching.add(topic);
    let needsCompact = false;
    for (let i = 0; i < subs.length; i += 1) {
      const sub = subs[i] as Subscription;
      if (sub.dead) {
        needsCompact = true;
        continue;
      }
      (sub.handler as EventHandler<T>)(payload);
      if (sub.once) {
        sub.dead = true;
        needsCompact = true;
      }
    }
    this.dispatching.delete(topic);
    if (needsCompact) this.compact(topic);
    this.flushPending();
  }

  on<T>(topic: string, handler: EventHandler<T>): () => void {
    const sub: Subscription = { handler: handler as EventHandler<never>, once: false, dead: false };
    this.attach(topic, sub);
    return () => {
      sub.dead = true;
      if (!this.dispatching.has(topic)) this.compact(topic);
    };
  }

  once<T>(topic: string, handler: EventHandler<T>): () => void {
    const sub: Subscription = { handler: handler as EventHandler<never>, once: true, dead: false };
    this.attach(topic, sub);
    return () => {
      sub.dead = true;
      if (!this.dispatching.has(topic)) this.compact(topic);
    };
  }

  off(topic: string, handler: EventHandler<never>): void {
    const subs = this.topics.get(topic);
    if (!subs) return;
    for (let i = 0; i < subs.length; i += 1) {
      const sub = subs[i] as Subscription;
      if (sub.handler === handler) sub.dead = true;
    }
    if (!this.dispatching.has(topic)) this.compact(topic);
  }

  clear(topic?: string): void {
    if (topic === undefined) {
      this.topics.clear();
      this.pending = [];
      return;
    }
    this.topics.delete(topic);
    this.pending = this.pending.filter((entry) => entry.topic !== topic);
  }

  listenerCount(topic: string): number {
    const subs = this.topics.get(topic);
    if (!subs) return 0;
    let count = 0;
    for (let i = 0; i < subs.length; i += 1) {
      if (!(subs[i] as Subscription).dead) count += 1;
    }
    return count;
  }

  topicNames(): string[] {
    return [...this.topics.keys()].sort();
  }

  private attach(topic: string, sub: Subscription): void {
    if (this.dispatching.has(topic)) {
      this.pending.push({ topic, sub });
      return;
    }
    const subs = this.topics.get(topic);
    if (subs) subs.push(sub);
    else this.topics.set(topic, [sub]);
  }

  private flushPending(): void {
    if (this.pending.length === 0) return;
    const queued = this.pending;
    this.pending = [];
    for (let i = 0; i < queued.length; i += 1) {
      const entry = queued[i] as { topic: string; sub: Subscription };
      if (this.dispatching.has(entry.topic)) {
        this.pending.push(entry);
        continue;
      }
      const subs = this.topics.get(entry.topic);
      if (subs) subs.push(entry.sub);
      else this.topics.set(entry.topic, [entry.sub]);
    }
  }

  private compact(topic: string): void {
    const subs = this.topics.get(topic);
    if (!subs) return;
    const live = subs.filter((sub) => !sub.dead);
    if (live.length === 0) this.topics.delete(topic);
    else this.topics.set(topic, live);
  }
}

/** Buffers payloads so a system can drain them at a deterministic point. */
export class EventQueue<T> {
  private items: T[] = [];
  private readonly unsubscribe: () => void;

  constructor(bus: EventBusLike, topic: string, limit = 256) {
    this.unsubscribe = bus.on<T>(topic, (payload) => {
      if (this.items.length >= limit) this.items.shift();
      this.items.push(payload);
    });
  }

  drain(): T[] {
    if (this.items.length === 0) return [];
    const out = this.items;
    this.items = [];
    return out;
  }

  peek(): readonly T[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }

  dispose(): void {
    this.unsubscribe();
    this.items = [];
  }
}

export function createEventBus(): EventBus {
  return new EventBus();
}
