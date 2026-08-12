/**
 * Inbox message aggregate — the consumer half of exactly-once-ish messaging.
 *
 * Anything arriving from outside the process (partner webhook, adapter pull,
 * peer service relay) is first *recorded*, then processed. Recording is
 * de-duplicated on `(tenantId, source, messageKey)`, so a sender retrying a
 * delivery cannot cause the handler to run twice.
 *
 * A duplicate carrying a different payload checksum is a real integration
 * bug (the sender reused a key), so it is surfaced as a conflict rather than
 * quietly ignored.
 *
 * Lifecycle:
 *   received ──begin──> processing ──ok──> processed
 *       ^                    │
 *       └── retry backoff ───┴──> failed ──replay──> received
 *   received | failed ──discard──> discarded
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { nextDelayMs, shouldRetry, type RetryPolicy } from "@enterprise-suite/event-bus";
import { IntegrationEventTypes, type InboxMessageReceivedPayload } from "./events.js";
import { fingerprint } from "./fingerprint.js";
import { addMs, atOrBefore } from "./time.js";

export type InboxStatus = "received" | "processing" | "processed" | "failed" | "discarded";

export interface InboxFailure {
  readonly message: string;
  readonly attempt: number;
  readonly at: IsoDateTime;
}

interface InboxMessageProps {
  source: string;
  messageKey: string;
  eventType: string;
  payload: unknown;
  checksum: string;
  headers: Record<string, string>;
  status: InboxStatus;
  attempts: number;
  maxAttempts: number;
  receivedAt: IsoDateTime;
  availableAt: IsoDateTime;
  processedAt?: IsoDateTime;
  lastFailure?: InboxFailure;
  discardReason?: string;
  /** How many redundant deliveries of this key were absorbed. */
  duplicateCount: number;
  result?: unknown;
}

export class InboxMessage extends AggregateRoot<InboxMessageProps> {
  private constructor(tenantId: TenantId, props: InboxMessageProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static receive(input: {
    tenantId: TenantId;
    source: string;
    messageKey: string;
    eventType: string;
    payload: unknown;
    now: IsoDateTime;
    headers?: Record<string, string>;
    maxAttempts?: number;
  }): InboxMessage {
    if (!input.source.trim()) throw new DomainError("source is required", "VALIDATION");
    if (!input.messageKey.trim()) throw new DomainError("messageKey is required", "VALIDATION");
    if (!input.eventType.trim()) throw new DomainError("eventType is required", "VALIDATION");

    const message = new InboxMessage(input.tenantId, {
      source: input.source.trim(),
      messageKey: input.messageKey.trim(),
      eventType: input.eventType.trim(),
      payload: input.payload,
      checksum: fingerprint(input.payload),
      headers: input.headers ?? {},
      status: "received",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      receivedAt: input.now,
      availableAt: input.now,
      duplicateCount: 0,
    });
    const payload: InboxMessageReceivedPayload = {
      source: message.props.source,
      messageKey: message.props.messageKey,
      eventType: message.props.eventType,
      checksum: message.props.checksum,
    };
    message.raise(
      envelope({
        eventType: IntegrationEventTypes.InboxMessageReceived,
        aggregateType: "InboxMessage",
        aggregateId: message.id,
        tenantId: input.tenantId,
        payload,
      }),
    );
    return message;
  }

  static rehydrate(
    tenantId: TenantId,
    props: InboxMessageProps,
    existing: Partial<EntityProps>,
  ): InboxMessage {
    return new InboxMessage(tenantId, props, existing);
  }

  get source(): string { return this.props.source; }
  get messageKey(): string { return this.props.messageKey; }
  get eventType(): string { return this.props.eventType; }
  get payload(): unknown { return this.props.payload; }
  get checksum(): string { return this.props.checksum; }
  get headers(): Readonly<Record<string, string>> { return this.props.headers; }
  get status(): InboxStatus { return this.props.status; }
  get attempts(): number { return this.props.attempts; }
  get availableAt(): IsoDateTime { return this.props.availableAt; }
  get duplicateCount(): number { return this.props.duplicateCount; }
  get lastFailure(): InboxFailure | undefined { return this.props.lastFailure; }
  get result(): unknown { return this.props.result; }
  get processedAt(): IsoDateTime | undefined { return this.props.processedAt; }
  get discardReason(): string | undefined { return this.props.discardReason; }

  /** Ready to be picked up by a processing worker. */
  isDue(now: IsoDateTime): boolean {
    return this.props.status === "received" && atOrBefore(this.props.availableAt, now);
  }

  /**
   * Records that the same key arrived again. A mismatching checksum means the
   * sender reused a key for different content.
   */
  noteDuplicate(payload: unknown): { sameChecksum: boolean } {
    const checksum = fingerprint(payload);
    const sameChecksum = checksum === this.props.checksum;
    this.props.duplicateCount += 1;
    this.touch();
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.InboxDuplicateIgnored,
        aggregateType: "InboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          messageKey: this.props.messageKey,
          originalId: this.id,
          sameChecksum,
        },
      }),
    );
    if (!sameChecksum) {
      throw new ConflictError(
        `Message key '${this.props.messageKey}' from '${this.props.source}' was already received with a different payload`,
      );
    }
    return { sameChecksum };
  }

  beginProcessing(now: IsoDateTime): void {
    if (this.props.status !== "received") {
      throw new ConflictError(`Only received messages can start processing (status=${this.props.status})`);
    }
    if (!atOrBefore(this.props.availableAt, now)) {
      throw new ConflictError(`Message is backing off until ${this.props.availableAt}`);
    }
    this.props.status = "processing";
    this.touch();
  }

  markProcessed(now: IsoDateTime, result?: unknown): void {
    if (this.props.status !== "processing") {
      throw new ConflictError(`Only processing messages can complete (status=${this.props.status})`);
    }
    this.props.attempts += 1;
    this.props.status = "processed";
    this.props.processedAt = now;
    this.props.result = result;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.InboxMessageProcessed,
        aggregateType: "InboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          messageKey: this.props.messageKey,
          eventType: this.props.eventType,
          attempts: this.props.attempts,
        },
      }),
    );
  }

  markFailed(input: { error: string; now: IsoDateTime; policy: RetryPolicy }): void {
    if (this.props.status !== "processing") {
      throw new ConflictError(`Only processing messages can fail (status=${this.props.status})`);
    }
    this.props.attempts += 1;
    this.props.lastFailure = { message: input.error, attempt: this.props.attempts, at: input.now };

    const budget = Math.min(this.props.maxAttempts, input.policy.maxAttempts);
    if (shouldRetry({ ...input.policy, maxAttempts: budget }, this.props.attempts)) {
      this.props.status = "received";
      this.props.availableAt = addMs(input.now, nextDelayMs(input.policy, this.props.attempts));
    } else {
      this.props.status = "failed";
    }
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.InboxMessageFailed,
        aggregateType: "InboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          messageKey: this.props.messageKey,
          eventType: this.props.eventType,
          attempts: this.props.attempts,
          error: input.error,
          terminal: this.props.status === "failed",
          nextAttemptAt: this.props.status === "received" ? this.props.availableAt : undefined,
        },
      }),
    );
  }

  discard(reason: string, now: IsoDateTime): void {
    if (this.props.status === "processed") {
      throw new ConflictError("Processed messages cannot be discarded");
    }
    if (!reason.trim()) throw new DomainError("reason is required", "VALIDATION");
    this.props.status = "discarded";
    this.props.discardReason = reason.trim();
    this.props.lastFailure = { message: reason.trim(), attempt: this.props.attempts, at: now };
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.InboxMessageDiscarded,
        aggregateType: "InboxMessage",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          source: this.props.source,
          messageKey: this.props.messageKey,
          reason: reason.trim(),
        },
      }),
    );
  }

  /** Operator action: hand a failed or discarded message back to the workers. */
  replay(now: IsoDateTime, extraAttempts = 3): void {
    if (this.props.status !== "failed" && this.props.status !== "discarded") {
      throw new ConflictError(`Only failed or discarded messages can be replayed (status=${this.props.status})`);
    }
    this.props.status = "received";
    this.props.availableAt = now;
    this.props.discardReason = undefined;
    this.props.maxAttempts = this.props.attempts + Math.max(1, extraAttempts);
    this.touch();
  }
}
