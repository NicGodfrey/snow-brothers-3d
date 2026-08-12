import {
  AggregateRoot,
  err,
  ok,
  type Result,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import {
  BPS_SCALE,
  newAllocationRuleId,
  type AccountId,
  type AllocationRuleId,
  type CostCenterId,
} from "./ids.js";

export interface AllocationTarget {
  readonly costCenterId: CostCenterId;
  readonly percentBps: number;
}

export interface AllocationRuleProps {
  name: string;
  description?: string;
  /** Costs are pulled from this (account, cost center) pair... */
  sourceAccountId: AccountId;
  sourceCostCenterId: CostCenterId;
  /** ...and pushed to these cost centers on the same account, split by basis points. */
  targets: AllocationTarget[];
  active: boolean;
}

export class AllocationRule extends AggregateRoot<AllocationRuleProps> {
  private constructor(tenantId: TenantId, props: AllocationRuleProps, id?: AllocationRuleId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static create(tenantId: TenantId, input: {
    name: string;
    description?: string;
    sourceAccountId: AccountId;
    sourceCostCenterId: CostCenterId;
    targets: AllocationTarget[];
  }): Result<AllocationRule> {
    if (input.name.trim().length === 0) return err("allocation rule name is required");
    if (input.targets.length === 0) return err("an allocation rule requires at least one target");
    for (const t of input.targets) {
      if (!Number.isInteger(t.percentBps) || t.percentBps <= 0) {
        return err("each target percentBps must be a positive integer");
      }
      if (t.costCenterId === input.sourceCostCenterId) {
        return err("a target cost center cannot equal the source cost center");
      }
    }
    const totalBps = input.targets.reduce((s, t) => s + t.percentBps, 0);
    if (totalBps !== BPS_SCALE) {
      return err(`target percentages must sum to ${BPS_SCALE} bps (100%), got ${totalBps}`);
    }
    const seen = new Set<string>();
    for (const t of input.targets) {
      if (seen.has(t.costCenterId)) return err("duplicate target cost center in allocation rule");
      seen.add(t.costCenterId);
    }
    return ok(new AllocationRule(tenantId, {
      name: input.name.trim(),
      description: input.description,
      sourceAccountId: input.sourceAccountId,
      sourceCostCenterId: input.sourceCostCenterId,
      targets: input.targets,
      active: true,
    }, newAllocationRuleId()));
  }

  get name(): string { return this.props.name; }
  get sourceAccountId(): AccountId { return this.props.sourceAccountId; }
  get sourceCostCenterId(): CostCenterId { return this.props.sourceCostCenterId; }
  get targets(): readonly AllocationTarget[] { return this.props.targets; }
  get active(): boolean { return this.props.active; }

  deactivate(): Result<void> {
    if (!this.props.active) return err(`allocation rule "${this.props.name}" is already inactive`);
    this.props = { ...this.props, active: false };
    this.touch();
    return ok(undefined);
  }

  /**
   * Splits an amount across targets by basis points using integer arithmetic.
   * Rounding remainders are pushed onto the final target so the split always
   * sums exactly to the source amount.
   */
  split(amountMinor: number): { costCenterId: CostCenterId; amountMinor: number }[] {
    const parts: { costCenterId: CostCenterId; amountMinor: number }[] = [];
    let allocated = 0;
    for (let i = 0; i < this.props.targets.length; i++) {
      const target = this.props.targets[i];
      const isLast = i === this.props.targets.length - 1;
      const share = isLast
        ? amountMinor - allocated
        : Math.floor((amountMinor * target.percentBps) / BPS_SCALE);
      allocated += share;
      parts.push({ costCenterId: target.costCenterId, amountMinor: share });
    }
    return parts;
  }
}
