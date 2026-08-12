import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import type { AttributeValue } from "./attribute.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { PlmEventTypes } from "./events.js";
import { isLifecycleState, type LifecycleState } from "./lifecycle.js";

/**
 * Engineering change order.
 *
 *   draft -> submitted -> approved -> implemented
 *                      \-> rejected
 *   draft/submitted -> cancelled
 *
 * An ECO bundles one or more concrete changes (release a BOM revision, move a
 * product's lifecycle, update attributes, discontinue a variant) behind an
 * approval quorum. The aggregate owns the workflow; actually *applying* the
 * items is EcoService's job because it touches other aggregates.
 */

export type EcoStatus = "draft" | "submitted" | "approved" | "rejected" | "implemented" | "cancelled";

export type EcoReason =
  | "design_fix"
  | "cost_reduction"
  | "quality"
  | "compliance"
  | "obsolescence"
  | "customer_request";

export const ECO_REASONS: readonly EcoReason[] = [
  "design_fix",
  "cost_reduction",
  "quality",
  "compliance",
  "obsolescence",
  "customer_request",
];

export type EcoPriority = "low" | "medium" | "high" | "critical";

export const ECO_PRIORITIES: readonly EcoPriority[] = ["low", "medium", "high", "critical"];

/** Discriminated union of the concrete changes an ECO can carry. */
export type EcoChange =
  | {
      readonly kind: "bom_release";
      readonly bomRevisionId: Ulid;
      readonly effectiveFrom: IsoDateTime;
      readonly effectiveTo?: IsoDateTime;
    }
  | {
      readonly kind: "lifecycle_transition";
      readonly to: LifecycleState;
      readonly reason?: string;
    }
  | {
      readonly kind: "attribute_update";
      readonly values: Readonly<Record<string, AttributeValue>>;
    }
  | {
      readonly kind: "variant_discontinue";
      readonly variantId: Ulid;
    };

export interface EcoItem {
  readonly id: Ulid;
  readonly productId: Ulid;
  readonly change: EcoChange;
  readonly description?: string;
}

export interface EcoApproval {
  readonly approverId: UserId;
  readonly decision: "approved" | "rejected";
  readonly comment?: string;
  readonly decidedAt: IsoDateTime;
}

export interface EcoProps {
  number: string;
  title: string;
  description?: string;
  reason: EcoReason;
  priority: EcoPriority;
  status: EcoStatus;
  requiredApprovals: number;
  items: EcoItem[];
  approvals: EcoApproval[];
  submittedAt?: IsoDateTime;
  submittedBy?: UserId;
  implementedAt?: IsoDateTime;
  implementedBy?: UserId;
  cancelledReason?: string;
}

export interface CreateEcoInput {
  readonly number: string;
  readonly title: string;
  readonly description?: string;
  readonly reason: EcoReason;
  readonly priority?: EcoPriority;
  readonly requiredApprovals?: number;
}

function validateChange(change: EcoChange): void {
  switch (change.kind) {
    case "bom_release":
      if (!change.bomRevisionId) {
        throw ValidationError.single("bomRevisionId", "required for bom_release items");
      }
      if (Number.isNaN(Date.parse(change.effectiveFrom))) {
        throw ValidationError.single("effectiveFrom", "invalid date");
      }
      return;
    case "lifecycle_transition":
      if (!isLifecycleState(change.to)) {
        throw ValidationError.single("to", `unknown lifecycle state "${change.to}"`);
      }
      return;
    case "attribute_update":
      if (Object.keys(change.values).length === 0) {
        throw ValidationError.single("values", "at least one attribute value required");
      }
      return;
    case "variant_discontinue":
      if (!change.variantId) {
        throw ValidationError.single("variantId", "required for variant_discontinue items");
      }
      return;
  }
}

export class Eco extends AggregateRoot<EcoProps> {
  static create(tenantId: TenantId, input: CreateEcoInput): Eco {
    if (input.title.trim().length === 0) {
      throw ValidationError.single("title", "title is required");
    }
    if (!ECO_REASONS.includes(input.reason)) {
      throw ValidationError.single("reason", `unknown reason "${input.reason}"`);
    }
    const requiredApprovals = input.requiredApprovals ?? 1;
    if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1 || requiredApprovals > 10) {
      throw ValidationError.single("requiredApprovals", "must be an integer between 1 and 10");
    }
    const eco = new Eco(tenantId, {
      number: input.number,
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      reason: input.reason,
      priority: input.priority ?? "medium",
      status: "draft",
      requiredApprovals,
      items: [],
      approvals: [],
    });
    eco.raise(
      envelope({
        eventType: PlmEventTypes.EcoCreated,
        aggregateType: "Eco",
        aggregateId: eco.id,
        tenantId,
        payload: { ecoId: eco.id, number: eco.props.number, title: eco.props.title },
      }),
    );
    return eco;
  }

  static fromSnapshot(snapshot: EntityProps & EcoProps): Eco {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Eco(
      tenantId,
      { ...props, items: [...props.items], approvals: [...props.approvals] },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get title(): string {
    return this.props.title;
  }
  get status(): EcoStatus {
    return this.props.status;
  }
  get reason(): EcoReason {
    return this.props.reason;
  }
  get priority(): EcoPriority {
    return this.props.priority;
  }
  get items(): readonly EcoItem[] {
    return this.props.items;
  }
  get approvals(): readonly EcoApproval[] {
    return this.props.approvals;
  }
  get requiredApprovals(): number {
    return this.props.requiredApprovals;
  }

  affectedProductIds(): readonly Ulid[] {
    return [...new Set(this.props.items.map((i) => i.productId))];
  }

  // --- commands ------------------------------------------------------------

  addItem(input: { readonly productId: Ulid; readonly change: EcoChange; readonly description?: string }): EcoItem {
    this.assertStatus("draft", "add items");
    validateChange(input.change);
    if (
      input.change.kind === "bom_release" &&
      this.props.items.some(
        (i) => i.change.kind === "bom_release" && i.change.bomRevisionId === input.change.bomRevisionId,
      )
    ) {
      throw new InvalidStateError(`Revision ${input.change.bomRevisionId} is already on this ECO`);
    }
    const item: EcoItem = {
      id: newId("ecoitem"),
      productId: input.productId,
      change: input.change,
      description: input.description?.trim() || undefined,
    };
    this.props.items.push(item);
    this.touch();
    return item;
  }

  removeItem(itemId: Ulid): void {
    this.assertStatus("draft", "remove items");
    const index = this.props.items.findIndex((i) => i.id === itemId);
    if (index === -1) throw new InvalidStateError(`Item ${itemId} not found on ECO ${this.props.number}`);
    this.props.items.splice(index, 1);
    this.touch();
  }

  submit(by: UserId, at: IsoDateTime): void {
    this.assertStatus("draft", "submit");
    if (this.props.items.length === 0) {
      throw new InvalidStateError(`ECO ${this.props.number} has no change items`);
    }
    this.props.status = "submitted";
    this.props.submittedAt = at;
    this.props.submittedBy = by;
    this.raise(
      envelope({
        eventType: PlmEventTypes.EcoSubmitted,
        aggregateType: "Eco",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ecoId: this.id, number: this.props.number, title: this.props.title },
      }),
    );
  }

  /**
   * Records an approval vote. One vote per approver; the submitter may not
   * approve their own ECO. Reaching the quorum flips the ECO to approved; a
   * single rejection rejects it outright.
   */
  recordDecision(
    approverId: UserId,
    decision: "approved" | "rejected",
    at: IsoDateTime,
    comment?: string,
  ): void {
    this.assertStatus("submitted", "approve or reject");
    if (approverId === this.props.submittedBy) {
      throw new InvalidStateError("The submitter cannot approve their own ECO");
    }
    if (this.props.approvals.some((a) => a.approverId === approverId)) {
      throw new InvalidStateError(`${approverId} has already voted on ECO ${this.props.number}`);
    }
    if (decision === "rejected" && (!comment || comment.trim().length === 0)) {
      throw ValidationError.single("comment", "a comment is required when rejecting");
    }
    this.props.approvals.push({ approverId, decision, comment: comment?.trim(), decidedAt: at });
    this.raise(
      envelope({
        eventType: PlmEventTypes.EcoApprovalRecorded,
        aggregateType: "Eco",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ecoId: this.id,
          number: this.props.number,
          title: this.props.title,
          approverId,
          decision,
          approvalsRecorded: this.props.approvals.filter((a) => a.decision === "approved").length,
          approvalsRequired: this.props.requiredApprovals,
        },
      }),
    );
    if (decision === "rejected") {
      this.props.status = "rejected";
      this.raise(
        envelope({
          eventType: PlmEventTypes.EcoRejected,
          aggregateType: "Eco",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: { ecoId: this.id, number: this.props.number, title: this.props.title },
        }),
      );
      return;
    }
    const approvedCount = this.props.approvals.filter((a) => a.decision === "approved").length;
    if (approvedCount >= this.props.requiredApprovals) {
      this.props.status = "approved";
      this.raise(
        envelope({
          eventType: PlmEventTypes.EcoApproved,
          aggregateType: "Eco",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: { ecoId: this.id, number: this.props.number, title: this.props.title },
        }),
      );
    }
  }

  /** Marks the ECO implemented. Call only after all items were applied. */
  markImplemented(by: UserId, at: IsoDateTime): void {
    this.assertStatus("approved", "implement");
    this.props.status = "implemented";
    this.props.implementedAt = at;
    this.props.implementedBy = by;
    this.raise(
      envelope({
        eventType: PlmEventTypes.EcoImplemented,
        aggregateType: "Eco",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ecoId: this.id,
          number: this.props.number,
          title: this.props.title,
          implementedBy: by,
          itemCount: this.props.items.length,
          affectedProductIds: this.affectedProductIds(),
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (this.props.status !== "draft" && this.props.status !== "submitted") {
      throw new InvalidStateError(
        `ECO ${this.props.number} is ${this.props.status}; only draft/submitted ECOs can be cancelled`,
      );
    }
    if (!reason || reason.trim().length === 0) {
      throw ValidationError.single("reason", "a cancellation reason is required");
    }
    this.props.status = "cancelled";
    this.props.cancelledReason = reason.trim();
    this.raise(
      envelope({
        eventType: PlmEventTypes.EcoCancelled,
        aggregateType: "Eco",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ecoId: this.id, number: this.props.number, title: this.props.title },
      }),
    );
  }

  private assertStatus(expected: EcoStatus, action: string): void {
    if (this.props.status !== expected) {
      throw new InvalidStateError(
        `Cannot ${action}: ECO ${this.props.number} is ${this.props.status}, expected ${expected}`,
      );
    }
  }
}
