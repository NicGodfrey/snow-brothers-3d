/**
 * Adapter registry use-cases: register a driver instance for a tenant,
 * validate and update its config, health-check it, push messages out and pull
 * messages in (pulled messages land in the inbox, so the same de-duplication
 * and retry rules apply as for pushed traffic).
 */
import {
  ConflictError,
  DomainError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  AdapterRegistration,
  type AdapterDescriptor,
  type AdapterDirection,
  type AdapterKind,
  type AdapterStatus,
} from "../domain/adapter.js";
import type { AdapterRepository } from "../domain/repositories.js";
import type { InboxService } from "./inbox-service.js";
import type {
  AdapterDriverRegistry,
  AdapterMessage,
  AdapterSendResult,
  Clock,
  EventPublisher,
} from "./ports.js";

export interface RegisterAdapterCommand {
  name: string;
  kind: AdapterKind;
  config: Record<string, unknown>;
  direction?: AdapterDirection;
  credentialsRef?: string;
}

export class AdapterService {
  constructor(
    private readonly adapters: AdapterRepository,
    private readonly drivers: AdapterDriverRegistry,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly inbox?: InboxService,
  ) {}

  /** Catalog of available drivers with their config schemas. */
  descriptors(): AdapterDescriptor[] {
    return this.drivers.descriptors();
  }

  async register(ctx: TenantContext, cmd: RegisterAdapterCommand): Promise<AdapterRegistration> {
    if (!this.drivers.has(cmd.kind)) {
      throw new DomainError(`No adapter driver registered for kind '${cmd.kind}'`, "VALIDATION");
    }
    const existing = await this.adapters.findByName(ctx.tenantId, cmd.name.trim());
    if (existing) throw new ConflictError(`An adapter named '${cmd.name}' already exists`);

    const driver = this.drivers.get(cmd.kind);
    const adapter = AdapterRegistration.register({
      tenantId: ctx.tenantId,
      name: cmd.name,
      descriptor: driver.descriptor,
      config: cmd.config,
      direction: cmd.direction,
      credentialsRef: cmd.credentialsRef,
    });
    await this.flush(adapter);
    return adapter;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<AdapterRegistration> {
    const adapter = await this.adapters.findById(ctx.tenantId, id);
    if (!adapter) throw new NotFoundError("AdapterRegistration", id);
    return adapter;
  }

  async list(
    ctx: TenantContext,
    filter?: { kind?: AdapterKind; status?: AdapterStatus; direction?: AdapterDirection },
  ): Promise<AdapterRegistration[]> {
    return this.adapters.list(ctx.tenantId, filter);
  }

  async configure(
    ctx: TenantContext,
    id: Ulid,
    config: Record<string, unknown>,
  ): Promise<AdapterRegistration> {
    const adapter = await this.get(ctx, id);
    adapter.configure(this.drivers.get(adapter.kind).descriptor, config);
    await this.flush(adapter);
    return adapter;
  }

  /** Runs the driver's connectivity probe and folds it into the health state. */
  async checkHealth(ctx: TenantContext, id: Ulid): Promise<AdapterRegistration> {
    const adapter = await this.get(ctx, id);
    const driver = this.drivers.get(adapter.kind);
    const result = await driver.test(adapter.config, this.clock.now());
    adapter.recordHealth(result);
    await this.flush(adapter);
    return adapter;
  }

  async enable(ctx: TenantContext, id: Ulid): Promise<AdapterRegistration> {
    const adapter = await this.get(ctx, id);
    adapter.enable();
    await this.flush(adapter);
    return adapter;
  }

  async disable(ctx: TenantContext, id: Ulid, reason: string): Promise<AdapterRegistration> {
    const adapter = await this.get(ctx, id);
    adapter.disable(reason);
    await this.flush(adapter);
    return adapter;
  }

  /**
   * Pushes messages through an adapter. Batches larger than the driver's
   * limit are rejected by the aggregate rather than silently truncated.
   */
  async send(
    ctx: TenantContext,
    id: Ulid,
    messages: readonly AdapterMessage[],
  ): Promise<{ adapter: AdapterRegistration; result: AdapterSendResult }> {
    const adapter = await this.get(ctx, id);
    if (messages.length === 0) throw new DomainError("no messages to send", "VALIDATION");
    const driver = this.drivers.get(adapter.kind);
    const result = await driver.send(adapter.config, messages);
    adapter.recordSend(result.accepted, this.clock.now());
    await this.flush(adapter);
    return { adapter, result };
  }

  /** Same as `send`, but for the relay: resolves the adapter by id internally. */
  async sendById(
    tenantId: TenantContext["tenantId"],
    id: Ulid,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const adapter = await this.adapters.findById(tenantId, id);
    if (!adapter) throw new NotFoundError("AdapterRegistration", id);
    const driver = this.drivers.get(adapter.kind);
    const result = await driver.send(adapter.config, messages);
    adapter.recordSend(result.accepted, this.clock.now());
    await this.flush(adapter);
    return result;
  }

  /**
   * Pulls from an inbound adapter and records everything in the inbox.
   * Requires an InboxService — the registry alone cannot consume messages.
   */
  async pull(
    ctx: TenantContext,
    id: Ulid,
    cursor?: string,
  ): Promise<{ adapter: AdapterRegistration; received: number; duplicates: number; cursor?: string }> {
    if (!this.inbox) {
      throw new ConflictError("This hub instance was built without an inbox; pulling is unavailable");
    }
    const adapter = await this.get(ctx, id);
    const driver = this.drivers.get(adapter.kind);
    const result = await driver.pull(adapter.config, cursor);

    let duplicates = 0;
    for (const message of result.messages) {
      const received = await this.inbox.receive(ctx, {
        source: `adapter:${adapter.name}`,
        messageKey: message.key,
        eventType: message.eventType,
        payload: message.payload,
        headers: message.headers ? { ...message.headers } : undefined,
      });
      if (received.duplicate) duplicates++;
    }
    adapter.recordPull(result.messages.length, this.clock.now());
    await this.flush(adapter);
    return { adapter, received: result.messages.length, duplicates, cursor: result.cursor };
  }

  private async flush(adapter: AdapterRegistration): Promise<void> {
    await this.adapters.save(adapter);
    await this.publisher.publishAll(adapter.pullEvents());
  }
}
