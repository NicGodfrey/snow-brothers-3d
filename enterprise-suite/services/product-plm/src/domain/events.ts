import type { IsoDateTime, Money, Ulid, UserId } from "@enterprise-suite/shared-kernel";
import type { AttributeValue } from "./attribute.js";
import type { LifecycleState } from "./lifecycle.js";
import type { UomCode } from "./uom.js";

/**
 * Domain event catalog for the PLM bounded context.
 *
 * Event type strings are namespaced `plm.<aggregate>.<event>` and versioned
 * through the envelope's schemaVersion. Payloads carry ids plus the data a
 * downstream consumer (MRP, procurement, reporting) needs without a
 * synchronous read-back.
 */

export const PlmEventTypes = {
  ProductCreated: "plm.product.created",
  ProductDetailsUpdated: "plm.product.details-updated",
  ProductAttributesSet: "plm.product.attributes-set",
  ProductCategoryAssigned: "plm.product.category-assigned",
  ProductLifecycleChanged: "plm.product.lifecycle-changed",
  ProductVariantAdded: "plm.product.variant-added",
  ProductVariantDiscontinued: "plm.product.variant-discontinued",
  ProductCostUpdated: "plm.product.cost-updated",
  CategoryCreated: "plm.category.created",
  CategoryMoved: "plm.category.moved",
  AttributeDefinitionCreated: "plm.attribute-definition.created",
  AttributeSetCreated: "plm.attribute-set.created",
  UomCreated: "plm.uom.created",
  BomCreated: "plm.bom.created",
  BomRevisionCreated: "plm.bom.revision-created",
  BomRevisionReleased: "plm.bom.revision-released",
  BomRevisionObsoleted: "plm.bom.revision-obsoleted",
  EcoCreated: "plm.eco.created",
  EcoSubmitted: "plm.eco.submitted",
  EcoApprovalRecorded: "plm.eco.approval-recorded",
  EcoApproved: "plm.eco.approved",
  EcoRejected: "plm.eco.rejected",
  EcoImplemented: "plm.eco.implemented",
  EcoCancelled: "plm.eco.cancelled",
} as const;

export type PlmEventType = (typeof PlmEventTypes)[keyof typeof PlmEventTypes];

export interface ProductCreatedPayload {
  readonly productId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly baseUom: UomCode;
  readonly lifecycle: LifecycleState;
}

export interface ProductLifecycleChangedPayload {
  readonly productId: Ulid;
  readonly code: string;
  readonly from: LifecycleState;
  readonly to: LifecycleState;
  readonly reason?: string;
  readonly changedBy: UserId;
}

export interface ProductVariantAddedPayload {
  readonly productId: Ulid;
  readonly variantId: Ulid;
  readonly sku: string;
  readonly axisValues: Readonly<Record<string, string>>;
}

export interface ProductVariantDiscontinuedPayload {
  readonly productId: Ulid;
  readonly variantId: Ulid;
  readonly sku: string;
}

export interface ProductAttributesSetPayload {
  readonly productId: Ulid;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export interface ProductCostUpdatedPayload {
  readonly productId: Ulid;
  readonly variantId?: Ulid;
  readonly cost: Money;
  readonly source: "manual" | "rollup";
}

export interface BomRevisionCreatedPayload {
  readonly bomId: Ulid;
  readonly productId: Ulid;
  readonly revisionId: Ulid;
  readonly revisionCode: string;
  readonly basedOnRevisionId?: Ulid;
}

export interface BomRevisionReleasedPayload {
  readonly bomId: Ulid;
  readonly productId: Ulid;
  readonly revisionId: Ulid;
  readonly revisionCode: string;
  readonly effectiveFrom: IsoDateTime;
  readonly effectiveTo?: IsoDateTime;
  readonly ecoId?: Ulid;
  readonly lineCount: number;
}

export interface EcoStatusPayload {
  readonly ecoId: Ulid;
  readonly number: string;
  readonly title: string;
}

export interface EcoApprovalRecordedPayload extends EcoStatusPayload {
  readonly approverId: UserId;
  readonly decision: "approved" | "rejected";
  readonly approvalsRecorded: number;
  readonly approvalsRequired: number;
}

export interface EcoImplementedPayload extends EcoStatusPayload {
  readonly implementedBy: UserId;
  readonly itemCount: number;
  readonly affectedProductIds: readonly Ulid[];
}
