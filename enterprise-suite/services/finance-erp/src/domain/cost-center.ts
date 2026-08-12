import {
  AggregateRoot,
  envelope,
  err,
  ok,
  type Result,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { newCostCenterId, type CostCenterId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";

export interface CostCenterProps {
  code: string;
  name: string;
  parentCode?: string;
  managerUserId?: string;
  active: boolean;
}

const COST_CENTER_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

export class CostCenter extends AggregateRoot<CostCenterProps> {
  private constructor(tenantId: TenantId, props: CostCenterProps, id?: CostCenterId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static create(tenantId: TenantId, input: {
    code: string;
    name: string;
    parentCode?: string;
    managerUserId?: string;
  }): Result<CostCenter> {
    const code = input.code.trim().toUpperCase();
    if (!COST_CENTER_CODE_RE.test(code)) {
      return err(`cost center code "${input.code}" must be 2-20 chars of A-Z, 0-9, dash`);
    }
    if (input.name.trim().length === 0) return err("cost center name is required");
    const cc = new CostCenter(tenantId, {
      code,
      name: input.name.trim(),
      parentCode: input.parentCode?.trim().toUpperCase(),
      managerUserId: input.managerUserId,
      active: true,
    }, newCostCenterId());
    cc.raise(envelope({
      eventType: FinanceEventTypes.CostCenterCreated,
      aggregateType: "CostCenter",
      aggregateId: cc.id,
      tenantId,
      payload: { costCenterId: cc.id, code },
    }));
    return ok(cc);
  }

  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get parentCode(): string | undefined { return this.props.parentCode; }
  get active(): boolean { return this.props.active; }

  deactivate(): Result<void> {
    if (!this.props.active) return err(`cost center ${this.props.code} is already inactive`);
    this.props = { ...this.props, active: false };
    this.touch();
    return ok(undefined);
  }
}
