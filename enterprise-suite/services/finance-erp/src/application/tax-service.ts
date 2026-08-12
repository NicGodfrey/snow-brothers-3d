import {
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import type { TaxCodeId } from "../domain/ids.js";
import { TaxCode, type TaxScope } from "../domain/tax-code.js";
import type { TaxCodeRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";

export class TaxService {
  constructor(
    private readonly taxCodes: TaxCodeRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async createTaxCode(ctx: TenantContext, command: {
    code: string;
    name: string;
    rateBps: number;
    scope?: TaxScope;
  }): Promise<TaxCode> {
    const code = command.code.trim().toUpperCase();
    const existing = await this.taxCodes.findByCode(ctx.tenantId, code);
    if (existing) throw new ConflictError(`tax code ${code} already exists`);
    const taxCode = expectOk(TaxCode.create(ctx.tenantId, command));
    await this.taxCodes.save(taxCode);
    this.outbox.publishAll(taxCode.pullEvents());
    return taxCode;
  }

  async getTaxCode(ctx: TenantContext, id: TaxCodeId): Promise<TaxCode> {
    const taxCode = await this.taxCodes.findById(ctx.tenantId, id);
    if (!taxCode) throw new NotFoundError("TaxCode", id);
    return taxCode;
  }

  async listTaxCodes(ctx: TenantContext): Promise<TaxCode[]> {
    return this.taxCodes.list(ctx.tenantId);
  }

  async deactivateTaxCode(ctx: TenantContext, id: TaxCodeId): Promise<TaxCode> {
    const taxCode = await this.getTaxCode(ctx, id);
    expectOk(taxCode.deactivate());
    await this.taxCodes.save(taxCode);
    return taxCode;
  }
}
