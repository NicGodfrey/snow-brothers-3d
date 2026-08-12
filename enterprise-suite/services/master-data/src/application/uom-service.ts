import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type TenantContext,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { UomError, ValidationError } from "../domain/errors.js";
import { MdmEventTypes } from "../domain/events.js";
import {
  ALL_PRODUCTS,
  STANDARD_UNITS,
  UOM_DIMENSIONS,
  UomConverter,
  UomRegistry,
  roundToIncrement,
  uomCode,
  type ConversionResult,
  type UnitOfMeasure,
  type UomConversion,
  type UomDimension,
} from "../domain/uom.js";
import type { Clock, OutboxPort, UomConversionRepository, UomRepository } from "./ports.js";

export interface CreateUomInput {
  readonly code: string;
  readonly name: string;
  readonly symbol?: string;
  readonly dimension: UomDimension;
  readonly toBase: number;
  readonly precision?: number;
}

export interface DefineConversionInput {
  readonly from: string;
  readonly to: string;
  readonly factor: number;
  /** Omit (or pass "*") for a conversion that applies to the whole catalog. */
  readonly productCode?: string;
  readonly note?: string;
}

/**
 * Units of measure and conversions.
 *
 * The standard catalog is shared; tenants add their own units (a "ROLL" of
 * 25 m, a "BOX12") and the item conversions that bridge dimensions — how many
 * eaches are in a case, how much a case weighs. Every conversion request
 * builds a registry and a converter for the tenant, so one tenant's "PALLET"
 * can be 48 units and another's 60 without interference.
 */
export class UomService {
  constructor(
    private readonly uoms: UomRepository,
    private readonly conversions: UomConversionRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async registryFor(tenantId: TenantId): Promise<UomRegistry> {
    const registry = new UomRegistry(STANDARD_UNITS);
    for (const custom of await this.uoms.all(tenantId)) {
      if (!registry.has(String(custom.code))) registry.register(custom);
    }
    return registry;
  }

  async converterFor(tenantId: TenantId): Promise<UomConverter> {
    return new UomConverter(await this.registryFor(tenantId), await this.conversions.all(tenantId));
  }

  async listUnits(
    ctx: TenantContext,
    filter: { readonly dimension?: UomDimension } = {},
  ): Promise<readonly UnitOfMeasure[]> {
    const registry = await this.registryFor(ctx.tenantId);
    return filter.dimension ? registry.inDimension(filter.dimension) : registry.all();
  }

  async getUnit(ctx: TenantContext, code: string): Promise<UnitOfMeasure> {
    const registry = await this.registryFor(ctx.tenantId);
    if (!registry.has(code)) throw new NotFoundError("UnitOfMeasure", code);
    return registry.resolve(code);
  }

  async createUnit(ctx: TenantContext, input: CreateUomInput): Promise<UnitOfMeasure> {
    if (!UOM_DIMENSIONS.includes(input.dimension)) {
      throw ValidationError.single("dimension", `unknown dimension "${input.dimension}"`);
    }
    if (!Number.isFinite(input.toBase) || input.toBase <= 0) {
      throw ValidationError.single("toBase", "base factor must be a positive number");
    }
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    const precision = input.precision ?? 6;
    if (!Number.isInteger(precision) || precision < 0 || precision > 10) {
      throw ValidationError.single("precision", "precision must be a whole number between 0 and 10");
    }
    const code = uomCode(input.code);
    const registry = await this.registryFor(ctx.tenantId);
    if (registry.has(String(code))) throw new ConflictError(`Unit ${code} already exists`);

    const unit: UnitOfMeasure = {
      code,
      name: input.name.trim(),
      symbol: input.symbol?.trim() || String(code).toLowerCase(),
      dimension: input.dimension,
      toBase: input.toBase,
      offset: 0,
      precision,
      isStandard: false,
    };
    await this.uoms.save(ctx.tenantId, unit);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.UomCreated,
        aggregateType: "UnitOfMeasure",
        aggregateId: newId("uom"),
        tenantId: ctx.tenantId,
        payload: {
          code: String(unit.code),
          name: unit.name,
          dimension: unit.dimension,
          toBase: unit.toBase,
          at: this.clock.now(),
        },
      }),
    ]);
    return unit;
  }

  async listConversions(ctx: TenantContext, productCode?: string): Promise<readonly UomConversion[]> {
    return productCode
      ? this.conversions.forProduct(ctx.tenantId, productCode)
      : this.conversions.all(ctx.tenantId);
  }

  /**
   * Defines an item conversion. Same-dimension pairs are rejected: those are
   * already derivable from the unit table, and an override would silently
   * contradict it (a "1 KG = 2.2 LB" row that disagrees with the catalog).
   */
  async defineConversion(ctx: TenantContext, input: DefineConversionInput): Promise<UomConversion> {
    if (!Number.isFinite(input.factor) || input.factor <= 0) {
      throw ValidationError.single("factor", "conversion factor must be a positive number");
    }
    const registry = await this.registryFor(ctx.tenantId);
    const from = registry.resolve(input.from);
    const to = registry.resolve(input.to);
    if (String(from.code) === String(to.code)) {
      throw ValidationError.single("to", "a conversion needs two different units");
    }
    if (from.dimension === to.dimension) {
      throw new UomError(
        `${from.code} and ${to.code} are both ${from.dimension} units and already convert through the unit catalog`,
      );
    }
    if (from.offset !== 0 || to.offset !== 0) {
      throw new UomError("Affine units (temperature scales) cannot take part in item conversions");
    }
    const productCode = (input.productCode ?? ALL_PRODUCTS).trim().toUpperCase();
    const existing = await this.conversions.find(
      ctx.tenantId,
      productCode,
      String(from.code),
      String(to.code),
    );
    if (existing) {
      throw new ConflictError(
        `A ${from.code} -> ${to.code} conversion already exists for ${productCode === ALL_PRODUCTS ? "all products" : productCode}`,
      );
    }

    const conversion: UomConversion = {
      productCode,
      from: from.code,
      to: to.code,
      factor: input.factor,
      note: input.note?.trim(),
    };
    await this.conversions.save(ctx.tenantId, conversion);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.UomConversionDefined,
        aggregateType: "UomConversion",
        aggregateId: newId("uomconv"),
        tenantId: ctx.tenantId,
        payload: {
          fromCode: String(conversion.from),
          toCode: String(conversion.to),
          factor: conversion.factor,
          productCode: productCode === ALL_PRODUCTS ? undefined : productCode,
        },
      }),
    ]);
    return conversion;
  }

  async removeConversion(
    ctx: TenantContext,
    input: { readonly from: string; readonly to: string; readonly productCode?: string },
  ): Promise<void> {
    const productCode = (input.productCode ?? ALL_PRODUCTS).trim().toUpperCase();
    const from = uomCode(input.from);
    const to = uomCode(input.to);
    const existing = await this.conversions.find(ctx.tenantId, productCode, String(from), String(to));
    if (!existing) throw new NotFoundError("UomConversion", `${productCode}:${from}>${to}`);
    await this.conversions.remove(ctx.tenantId, productCode, String(from), String(to));
  }

  async convert(
    ctx: TenantContext,
    input: {
      readonly value: number;
      readonly from: string;
      readonly to: string;
      readonly productCode?: string;
    },
  ): Promise<ConversionResult> {
    if (!Number.isFinite(input.value)) {
      throw ValidationError.single("value", "must be a finite number");
    }
    const converter = await this.converterFor(ctx.tenantId);
    return converter.convert(input.value, input.from, input.to, input.productCode);
  }

  /** Every unit the value can reach, for building a UoM picker. */
  async convertibleUnits(
    ctx: TenantContext,
    from: string,
    productCode?: string,
  ): Promise<readonly UnitOfMeasure[]> {
    const registry = await this.registryFor(ctx.tenantId);
    const converter = new UomConverter(registry, await this.conversions.all(ctx.tenantId));
    return registry
      .all()
      .filter((unit) => String(unit.code) !== String(registry.resolve(from).code))
      .filter((unit) => converter.canConvert(from, unit.code, productCode));
  }

  /** Rounds an order quantity to a packaging multiple. */
  roundToMultiple(
    value: number,
    increment: number,
    mode: "up" | "down" | "nearest" = "up",
  ): number {
    return roundToIncrement(value, increment, mode);
  }
}
