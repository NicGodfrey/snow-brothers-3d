/**
 * Inbox use-cases: record inbound messages once, process them with a
 * registered handler, retry with backoff, and give operators a replay path.
 *
 * Handlers are registered against topic patterns, so one hub can host
 * "partner order imports" and "carrier status updates" side by side.
 */
import {
  ConflictError,
  DomainError,
  NotFoundError,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { matchTopic, NETWORK_RETRY_POLICY, type RetryPolicy } from "@enterprise-suite/event-bus";
import { InboxMessage, type InboxStatus } from "../domain/inbox.js";
import type { InboxRepository, StatusCounts } from "../domain/repositories.js";
import type { Clock, EventPublisher, HubLogger, InboxHandler } from "./ports.js";

export interface ReceiveResult {
  readonly message: InboxMessage;
  readonly duplicate: boolean;
}

export interface ProcessSummary {
  readonly picked: number;
  readonly processed: number;
  readonly failed: number;
}

export class InboxService {
  private readonly handlers: { pattern: string; handler: InboxHandler }[] = [];

  constructor(
    private readonly inbox: InboxRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly retry: RetryPolicy = NETWORK_RETRY_POLICY,
    private readonly logger?: HubLogger,
  ) {}

  /** Registers a handler for an event-type pattern (first match wins). */
  onEvent(pattern: string, handler: InboxHandler): this {
    this.handlers.push({ pattern, handler });
    return this;
  }

  private handlerFor(eventType: string): InboxHandler | undefined {
    return this.handlers.find((entry) => matchTopic(entry.pattern, eventType))?.handler;
  }

  /**
   * Records an inbound message. A repeat of a known key is absorbed; a repeat
   * carrying different content is rejected as a sender-side key-reuse bug.
   */
  async receive(
    ctx: TenantContext,
    input: {
      source: string;
      messageKey: string;
      eventType: string;
      payload: unknown;
      headers?: Record<string, string>;
      maxAttempts?: number;
    },
  ): Promise<ReceiveResult> {
    const existing = await this.inbox.findByKey(ctx.tenantId, input.source, input.messageKey);
    if (existing) {
      try {
        existing.noteDuplicate(input.payload);
      } finally {
        await this.flush(existing);
      }
      return { message: existing, duplicate: true };
    }

    const message = InboxMessage.receive({
      tenantId: ctx.tenantId,
      source: input.source,
      messageKey: input.messageKey,
      eventType: input.eventType,
      payload: input.payload,
      headers: input.headers,
      maxAttempts: input.maxAttempts,
      now: this.clock.now(),
    });
    await this.flush(message);
    return { message, duplicate: false };
  }

  /** Runs the handler for one message; used by the worker and by the API. */
  async process(ctx: TenantContext, id: Ulid): Promise<InboxMessage> {
    const message = await this.get(ctx, id);
    await this.runHandler(message);
    return message;
  }

  /** Worker loop: processes every due message. */
  async processDue(limit = 50, filter?: { tenantId?: TenantId; source?: string }): Promise<ProcessSummary> {
    const due = await this.inbox.listDue(this.clock.now(), limit, filter);
    let processed = 0;
    let failed = 0;
    for (const message of due) {
      const ok = await this.runHandler(message);
      if (ok) processed++;
      else failed++;
    }
    return { picked: due.length, processed, failed };
  }

  private async runHandler(message: InboxMessage): Promise<boolean> {
    const handler = this.handlerFor(message.eventType);
    message.beginProcessing(this.clock.now());
    await this.inbox.save(message);

    if (!handler) {
      message.markFailed({
        error: `no inbox handler registered for '${message.eventType}'`,
        now: this.clock.now(),
        policy: this.retry,
      });
      await this.flush(message);
      return false;
    }

    try {
      const result = await handler({
        tenantId: message.tenantId,
        source: message.source,
        eventType: message.eventType,
        messageKey: message.messageKey,
        payload: message.payload,
        headers: message.headers,
      });
      message.markProcessed(this.clock.now(), result);
      await this.flush(message);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      message.markFailed({ error: reason, now: this.clock.now(), policy: this.retry });
      await this.flush(message);
      this.logger?.warn("inbox handler failed", {
        messageId: message.id,
        eventType: message.eventType,
        attempts: message.attempts,
        error: reason,
      });
      return false;
    }
  }

  async get(ctx: TenantContext, id: Ulid): Promise<InboxMessage> {
    const message = await this.inbox.findById(ctx.tenantId, id);
    if (!message) throw new NotFoundError("InboxMessage", id);
    return message;
  }

  async list(
    ctx: TenantContext,
    filter?: { status?: InboxStatus; source?: string; eventType?: string },
  ): Promise<InboxMessage[]> {
    return this.inbox.list(ctx.tenantId, filter);
  }

  async discard(ctx: TenantContext, id: Ulid, reason: string): Promise<InboxMessage> {
    const message = await this.get(ctx, id);
    message.discard(reason, this.clock.now());
    await this.flush(message);
    return message;
  }

  async replay(ctx: TenantContext, id: Ulid, extraAttempts?: number): Promise<InboxMessage> {
    const message = await this.get(ctx, id);
    message.replay(this.clock.now(), extraAttempts);
    await this.inbox.save(message);
    return message;
  }

  async replayFailed(ctx: TenantContext, filter?: { source?: string }): Promise<number> {
    const failed = await this.inbox.list(ctx.tenantId, { status: "failed", source: filter?.source });
    for (const message of failed) {
      message.replay(this.clock.now());
      await this.inbox.save(message);
    }
    return failed.length;
  }

  async stats(ctx: TenantContext): Promise<StatusCounts> {
    return this.inbox.countsByStatus(ctx.tenantId);
  }

  /** Guard used by HTTP ingestion before touching the store. */
  assertKnownEventType(eventType: string): void {
    if (!this.handlerFor(eventType)) {
      throw new DomainError(
        `No handler is registered for event type '${eventType}'`,
        "UNROUTABLE_EVENT_TYPE",
        422,
      );
    }
  }

  /** Rejects a message whose source is not configured (defence in depth). */
  assertKnownSource(source: string, allowed: readonly string[]): void {
    if (allowed.length > 0 && !allowed.includes(source)) {
      throw new ConflictError(`Source '${source}' is not an accepted inbox source`);
    }
  }

  private async flush(message: InboxMessage): Promise<void> {
    await this.inbox.save(message);
    await this.publisher.publishAll(message.pullEvents());
  }
}
