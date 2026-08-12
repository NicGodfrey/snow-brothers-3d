import {
  ConflictError,
  envelope,
  newId,
  type TenantContext,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { PlmEventTypes } from "../domain/events.js";
import {
  STANDARD_UNITS,
  UOM_DIMENSIONS,
  UomRegistry,
  uomCode,
  type UnitOfMeasure,
  type UomDimension,
} from "../domain/uom.js";
import { ValidationError } from "../domain/errors.js";
import type { Clock, OutboxPort, UomRepository } from "./ports.js";

export interface CreateUomInput {
  readonly code: string;
  readonly name: string;
  readonly dimension: UomDimension;
  readonly toBase: number;
  readonly precision?: number;
}

/**
 * Units of measure: the standard catalog plus tenant-defined units (e.g.
 * "ROLL" = 25 M, "BOX12" = 12 EA). The per-tenant registry backs every
 * conversion in BOM explosion and costing.
 */
export class UomService {
  constructor(
    private readonly uoms: UomRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async registryFor(tenantId: TenantId): Promise<UomRegistry> {
    const registry = new UomRegistry(STANDARD_UNITS);
    for (const custom of await this.uoms.all(tenantId)) {
      if (!registry.has(custom.code)) registry.register(custom);
    }
    return registry;
  }

  async listUnits(ctx: TenantContext): Promise<readonly UnitOfMeasure[]> {
    const registry = await this.registryFor(ctx.tenantId);
    return registry.all();
  }

  async createUnit(ctx: TenantContext, input: CreateUomInput): Promise<UnitOfMeasure> {
    if (!UOM_DIMENSIONS.includes(input.dimension)) {
      throw ValidationError.single("dimension", `unknown dimension "${input.dimension}"`);
    }
    if (!(input.toBase > 0) || !Number.isFinite(input.toBase)) {
      throw ValidationError.single("toBase", "base factor must be a positive number");
    }
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    const code = uomCode(input.code);
    const registry = await this.registryFor(ctx.tenantId);
    if (registry.has(code)) {
      throw new ConflictError(`Unit ${code} already exists`);
    }
    const unit: UnitOfMeasure = {
      code,
      name: input.name.trim(),
      dimension: input.dimension,
      toBase: input.toBase,
      precision: input.precision ?? 6,
    };
    await this.uoms.save(ctx.tenantId, unit);
    await this.outbox.publish([
      envelope({
        eventType: PlmEventTypes.UomCreated,
        aggregateType: "UnitOfMeasure",
        aggregateId: newId("uom"),
        tenantId: ctx.tenantId,
        payload: { code: unit.code, name: unit.name, dimension: unit.dimension, toBase: unit.toBase },
      }),
    ]);
    return unit;
  }

  async convert(
    ctx: TenantContext,
    input: { readonly value: number; readonly from: string; readonly to: string },
  ): Promise<{ value: number; from: string; to: string; result: number }> {
    const registry = await this.registryFor(ctx.tenantId);
    const result = registry.convert(input.value, input.from, input.to);
    return { value: input.value, from: registry.resolve(input.from).code, to: registry.resolve(input.to).code, result };
  }
}
