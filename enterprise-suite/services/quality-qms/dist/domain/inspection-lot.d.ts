/**
 * Inspection Lot aggregate.
 *
 * A lot is a concrete quantity of material submitted for inspection against
 * a plan. The lot snapshots the plan's characteristics and sampling outcome
 * at creation so plan revisions never mutate in-flight inspections.
 *
 * Workflow: created -> in-progress -> completed -> decided
 *           (created | in-progress) -> cancelled
 *
 * Results are recorded per characteristic:
 *  - quantitative: individual readings evaluated against spec limits,
 *    with SPC statistics (mean/stdDev/Cp/Cpk) computed on the fly
 *  - attribute: inspected/defective counts evaluated against the lot's
 *    acceptance number (from the AQL plan) — criticals always use Ac=0
 *
 * The usage decision (accept / reject / accept-with-deviation / partial)
 * is validated against recorded results: a clean lot cannot be rejected
 * "by accident" without a reason, and a lot with failed criticals cannot
 * be plainly accepted.
 */
import { AggregateRoot, type EntityProps, type IsoDateTime, type TenantId, type Ulid, type UserId } from "@enterprise-suite/shared-kernel";
import type { InspectionCharacteristic, LotOrigin } from "./inspection-plan.js";
import { type ReadingStatistics } from "./statistics.js";
import type { SamplingOutcome } from "./sampling.js";
export type LotStatus = "created" | "in-progress" | "completed" | "decided" | "cancelled";
export type ResultEvaluation = "pass" | "fail";
export type UsageDecisionType = "accept" | "reject" | "accept-with-deviation" | "partial";
export interface QuantitativeResultInput {
    readonly readings: readonly number[];
}
export interface AttributeResultInput {
    readonly inspected: number;
    readonly defective: number;
}
export interface CharacteristicResult {
    readonly characteristicId: Ulid;
    readonly code: string;
    readonly type: "quantitative" | "attribute";
    readonly criticality: "critical" | "major" | "minor";
    readonly readings?: readonly number[];
    readonly attribute?: {
        inspected: number;
        defective: number;
    };
    readonly statistics?: ReadingStatistics;
    readonly evaluation: ResultEvaluation;
    readonly note?: string;
    readonly recordedBy: UserId;
    readonly recordedAt: IsoDateTime;
}
export interface UsageDecision {
    readonly decision: UsageDecisionType;
    readonly acceptedQuantity: number;
    readonly rejectedQuantity: number;
    readonly note?: string;
    readonly decidedBy: UserId;
    readonly decidedAt: IsoDateTime;
}
export interface LotLinkage {
    readonly supplierId?: string;
    readonly purchaseOrderRef?: string;
    readonly workOrderRef?: string;
    readonly customerRef?: string;
    readonly batchNumber?: string;
}
interface InspectionLotProps {
    lotNumber: string;
    planId: Ulid;
    planCode: string;
    planRevision: number;
    origin: LotOrigin;
    materialCode: string;
    quantity: number;
    uom: string;
    linkage: LotLinkage;
    sampling: SamplingOutcome;
    /** Snapshot of plan characteristics at lot creation. */
    characteristics: InspectionCharacteristic[];
    status: LotStatus;
    results: CharacteristicResult[];
    usageDecision?: UsageDecision;
    cancellationReason?: string;
}
export declare class InspectionLot extends AggregateRoot<InspectionLotProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        lotNumber: string;
        planId: Ulid;
        planCode: string;
        planRevision: number;
        origin: LotOrigin;
        materialCode: string;
        quantity: number;
        uom: string;
        linkage?: LotLinkage;
        sampling: SamplingOutcome;
        characteristics: readonly InspectionCharacteristic[];
    }): InspectionLot;
    static rehydrate(tenantId: TenantId, props: InspectionLotProps, existing: Partial<EntityProps>): InspectionLot;
    get lotNumber(): string;
    get status(): LotStatus;
    get origin(): LotOrigin;
    get planId(): Ulid;
    get materialCode(): string;
    get quantity(): number;
    get uom(): string;
    get linkage(): LotLinkage;
    get sampling(): SamplingOutcome;
    get results(): readonly CharacteristicResult[];
    get usageDecision(): UsageDecision | undefined;
    get characteristics(): readonly InspectionCharacteristic[];
    missingCharacteristicCodes(): string[];
    failedResults(): CharacteristicResult[];
    hasCriticalFailure(): boolean;
    start(): void;
    recordQuantitativeResult(characteristicCode: string, input: QuantitativeResultInput, recordedBy: UserId, note?: string): CharacteristicResult;
    recordAttributeResult(characteristicCode: string, input: AttributeResultInput, recordedBy: UserId, note?: string): CharacteristicResult;
    private characteristicForRecording;
    private pushResult;
    complete(): void;
    decide(decision: UsageDecisionType, decidedBy: UserId, options?: {
        note?: string;
        acceptedQuantity?: number;
    }): UsageDecision;
    cancel(reason: string): void;
}
export {};
//# sourceMappingURL=inspection-lot.d.ts.map