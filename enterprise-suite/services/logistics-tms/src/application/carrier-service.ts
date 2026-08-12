import {
  ConflictError,
  NotFoundError,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Carrier, type CreateCarrierInput, type ServiceLevel } from "../domain/carrier.js";
import type { TransportMode } from "../domain/values.js";
import type { CarrierRepository } from "../infrastructure/repositories.js";
import type { OutboxPort } from "../infrastructure/outbox.js";

export class CarrierService {
  constructor(
    private readonly carriers: CarrierRepository,
    private readonly outbox: OutboxPort,
  ) {}

  async createCarrier(ctx: TenantContext, input: CreateCarrierInput): Promise<Carrier> {
    const existing = await this.carriers.findByCode(ctx.tenantId, input.code ?? "");
    if (existing !== undefined) {
      throw new ConflictError(`Carrier code '${existing.code}' already exists`);
    }
    const carrier = Carrier.create(ctx.tenantId, input);
    await this.carriers.save(carrier);
    this.outbox.enqueue(carrier.pullEvents());
    return carrier;
  }

  async updateCarrier(
    ctx: TenantContext,
    carrierId: Ulid,
    input: { name?: string; scac?: string },
  ): Promise<Carrier> {
    const carrier = await this.requireCarrier(ctx, carrierId);
    carrier.update(input);
    await this.carriers.save(carrier);
    this.outbox.enqueue(carrier.pullEvents());
    return carrier;
  }

  async activateCarrier(ctx: TenantContext, carrierId: Ulid): Promise<Carrier> {
    const carrier = await this.requireCarrier(ctx, carrierId);
    carrier.activate();
    await this.carriers.save(carrier);
    this.outbox.enqueue(carrier.pullEvents());
    return carrier;
  }

  async deactivateCarrier(ctx: TenantContext, carrierId: Ulid): Promise<Carrier> {
    const carrier = await this.requireCarrier(ctx, carrierId);
    carrier.deactivate();
    await this.carriers.save(carrier);
    this.outbox.enqueue(carrier.pullEvents());
    return carrier;
  }

  async upsertServiceLevel(
    ctx: TenantContext,
    carrierId: Ulid,
    input: ServiceLevel,
  ): Promise<Carrier> {
    const carrier = await this.requireCarrier(ctx, carrierId);
    carrier.upsertServiceLevel(input);
    await this.carriers.save(carrier);
    this.outbox.enqueue(carrier.pullEvents());
    return carrier;
  }

  async removeServiceLevel(ctx: TenantContext, carrierId: Ulid, code: string): Promise<Carrier> {
    const carrier = await this.requireCarrier(ctx, carrierId);
    carrier.removeServiceLevel(code);
    await this.carriers.save(carrier);
    this.outbox.enqueue(carrier.pullEvents());
    return carrier;
  }

  async getCarrier(ctx: TenantContext, carrierId: Ulid): Promise<Carrier> {
    return this.requireCarrier(ctx, carrierId);
  }

  async listCarriers(
    ctx: TenantContext,
    filter?: { status?: string; mode?: TransportMode },
    page?: Partial<PageRequest>,
  ): Promise<Page<Carrier>> {
    const items = await this.carriers.list(ctx.tenantId, filter);
    return paginate(items, normalizePage(page));
  }

  private async requireCarrier(ctx: TenantContext, carrierId: Ulid): Promise<Carrier> {
    const carrier = await this.carriers.findById(ctx.tenantId, carrierId);
    if (carrier === undefined) {
      throw new NotFoundError("Carrier", carrierId);
    }
    return carrier;
  }
}
