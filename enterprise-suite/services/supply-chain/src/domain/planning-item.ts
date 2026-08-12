import {
  AggregateRoot,
  DomainError,
  envelope,
  money,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { SupplyChainEvents } from "./events.js";
import { parseLotSizingRule, type LotSizingRule } from "./lot-sizing.js";
import { assertIntInRange, assertQty, assertUom, supplierId, type SupplierId, type UnitOfMeasure } from "./types.js";

export type ProcurementType = "MAKE" | "BUY";

/**
 * Single-level bill-of-material line: producing 1 unit of the parent consumes
 * `qtyPer x (1 + scrapPct)` of the component.
 */
export interface BomLine {
  readonly componentSku: string;
  readonly qtyPer: number;
  /** Expected scrap fraction, 0..0.5 (e.g. 0.02 = 2% extra issued). */
  readonly scrapPct: number;
}

export function effectiveQtyPer(line: BomLine): number {
  return line.qtyPer * (1 + line.scrapPct);
}

interface PlanningItemProps {
  sku: string;
  description: string;
  uom: UnitOfMeasure;
  procurementType: ProcurementType;
  leadTimeDays: number;
  lotSizing: LotSizingRule;
  safetyStockPolicyId: Ulid | null;
  preferredSupplierId: SupplierId | null;
  standardCost: Money | null;
  bom: readonly BomLine[];
  active: boolean;
}

export interface CreatePlanningItemInput {
  sku: string;
  description: string;
  uom?: string;
  procurementType: ProcurementType;
  leadTimeDays: number;
  lotSizing?: unknown;
  safetyStockPolicyId?: Ulid;
  preferredSupplierId?: string;
  standardCostMinor?: number;
  currency?: string;
  bom?: readonly { componentSku: string; qtyPer: number; scrapPct?: number }[];
}

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function normalizeSku(sku: string): string {
  const v = sku?.trim().toUpperCase();
  if (!v || !SKU_RE.test(v)) throw new DomainError(`Invalid SKU: ${sku}`, "VALIDATION");
  return v;
}

function parseBomLines(sku: string, raw: readonly { componentSku: string; qtyPer: number; scrapPct?: number }[]): BomLine[] {
  const seen = new Set<string>();
  return raw.map((line) => {
    const componentSku = normalizeSku(line.componentSku);
    if (componentSku === sku) {
      throw new DomainError(`Item ${sku} cannot be its own component`, "VALIDATION");
    }
    if (seen.has(componentSku)) {
      throw new DomainError(`Duplicate BOM component ${componentSku} on ${sku}`, "VALIDATION");
    }
    seen.add(componentSku);
    const qtyPer = assertQty("qtyPer", line.qtyPer, { allowZero: false });
    const scrapPct = line.scrapPct ?? 0;
    if (typeof scrapPct !== "number" || scrapPct < 0 || scrapPct > 0.5) {
      throw new DomainError("scrapPct must be between 0 and 0.5", "VALIDATION");
    }
    return { componentSku, qtyPer, scrapPct };
  });
}

/**
 * Planning master data for one SKU: procurement type, lead time, lot-sizing
 * rule, safety stock policy reference and single-level BOM. The MRP engine
 * treats MAKE items as producible (their planned orders explode into
 * component demand) and BUY items as supplier-sourced (their planned orders
 * are candidate purchase orders and load supplier capacity).
 */
export class PlanningItem extends AggregateRoot<PlanningItemProps> {
  static create(tenantId: TenantId, input: CreatePlanningItemInput): PlanningItem {
    const sku = normalizeSku(input.sku);
    const description = input.description?.trim();
    if (!description) throw new DomainError("Item description is required", "VALIDATION");
    if (input.procurementType !== "MAKE" && input.procurementType !== "BUY") {
      throw new DomainError("procurementType must be MAKE or BUY", "VALIDATION");
    }
    const leadTimeDays = assertIntInRange("leadTimeDays", input.leadTimeDays, 0, 365);
    const bom = parseBomLines(sku, input.bom ?? []);
    if (input.procurementType === "BUY" && bom.length > 0) {
      throw new DomainError("BUY items cannot carry a BOM", "VALIDATION");
    }
    let standardCost: Money | null = null;
    if (input.standardCostMinor !== undefined) {
      standardCost = money(input.standardCostMinor, input.currency ?? "USD");
    }
    const item = new PlanningItem(tenantId, {
      sku,
      description,
      uom: input.uom === undefined ? "EA" : assertUom(input.uom),
      procurementType: input.procurementType,
      leadTimeDays,
      lotSizing: input.lotSizing === undefined ? { type: "LOT_FOR_LOT" } : parseLotSizingRule(input.lotSizing),
      safetyStockPolicyId: input.safetyStockPolicyId ?? null,
      preferredSupplierId: input.preferredSupplierId === undefined ? null : supplierId(input.preferredSupplierId),
      standardCost,
      bom,
      active: true,
    });
    item.raise(
      envelope({
        eventType: SupplyChainEvents.ItemCreated,
        aggregateType: "PlanningItem",
        aggregateId: item.id,
        tenantId,
        payload: { itemId: item.id, sku, procurementType: input.procurementType, leadTimeDays },
      }),
    );
    return item;
  }

  get sku(): string {
    return this.props.sku;
  }

  get procurementType(): ProcurementType {
    return this.props.procurementType;
  }

  get leadTimeDays(): number {
    return this.props.leadTimeDays;
  }

  get lotSizing(): LotSizingRule {
    return this.props.lotSizing;
  }

  get safetyStockPolicyId(): Ulid | null {
    return this.props.safetyStockPolicyId;
  }

  get preferredSupplierId(): SupplierId | null {
    return this.props.preferredSupplierId;
  }

  get standardCost(): Money | null {
    return this.props.standardCost;
  }

  get bom(): readonly BomLine[] {
    return this.props.bom;
  }

  get active(): boolean {
    return this.props.active;
  }

  changeLotSizing(rule: unknown): void {
    this.props = { ...this.props, lotSizing: parseLotSizingRule(rule) };
    this.touch();
  }

  assignSafetyStockPolicy(policyId: Ulid | null): void {
    this.props = { ...this.props, safetyStockPolicyId: policyId };
    this.touch();
  }

  replaceBom(lines: readonly { componentSku: string; qtyPer: number; scrapPct?: number }[]): void {
    if (this.props.procurementType === "BUY" && lines.length > 0) {
      throw new DomainError("BUY items cannot carry a BOM", "VALIDATION");
    }
    const bom = parseBomLines(this.props.sku, lines);
    this.props = { ...this.props, bom };
    this.raise(
      envelope({
        eventType: SupplyChainEvents.ItemBomChanged,
        aggregateType: "PlanningItem",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { itemId: this.id, sku: this.props.sku, componentCount: bom.length },
      }),
    );
  }

  deactivate(): void {
    if (!this.props.active) throw new DomainError("Item is already inactive", "CONFLICT", 409);
    this.props = { ...this.props, active: false };
    this.touch();
  }
}
