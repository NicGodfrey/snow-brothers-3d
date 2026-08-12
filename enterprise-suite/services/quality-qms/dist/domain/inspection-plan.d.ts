/**
 * Inspection Plan aggregate.
 *
 * A plan describes WHAT to inspect for a material/product/process: the list
 * of characteristics (quantitative with spec limits, or attribute pass/fail)
 * and HOW MANY units to sample (sampling rule). Plans are versioned via
 * `revision`; inspection lots snapshot the characteristics at creation time
 * so a later plan revision never changes an in-flight lot.
 *
 * Lifecycle: draft -> active -> retired. Only draft plans are editable.
 */
import { AggregateRoot, type EntityProps, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type SamplingRule } from "./sampling.js";
export type PlanStatus = "draft" | "active" | "retired";
export type PlanTargetType = "material" | "product" | "process";
export type CharacteristicType = "quantitative" | "attribute";
export type Criticality = "critical" | "major" | "minor";
export type LotOrigin = "goods-receipt" | "in-process" | "final" | "customer-return" | "stock-audit";
export interface QuantitativeSpec {
    readonly unit: string;
    readonly target?: number;
    readonly lowerLimit?: number;
    readonly upperLimit?: number;
    readonly decimals?: number;
}
export interface InspectionCharacteristic {
    readonly id: Ulid;
    readonly code: string;
    readonly name: string;
    readonly type: CharacteristicType;
    readonly criticality: Criticality;
    /** Measurement method / instrument hint, e.g. "caliper", "visual", "CMM". */
    readonly method?: string;
    readonly quantitative?: QuantitativeSpec;
    /** Inspect fewer units than the lot sample for this characteristic. */
    readonly sampleSizeOverride?: number;
}
export interface CharacteristicInput {
    code: string;
    name: string;
    type: CharacteristicType;
    criticality: Criticality;
    method?: string;
    quantitative?: QuantitativeSpec;
    sampleSizeOverride?: number;
}
interface InspectionPlanProps {
    planCode: string;
    name: string;
    description?: string;
    targetType: PlanTargetType;
    /** Material / SKU the plan applies to (required for material & product). */
    materialCode?: string;
    revision: number;
    status: PlanStatus;
    /** Lot origins this plan may be used for. Empty = any origin. */
    allowedOrigins: LotOrigin[];
    samplingRule: SamplingRule;
    characteristics: InspectionCharacteristic[];
}
export declare class InspectionPlan extends AggregateRoot<InspectionPlanProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        planCode: string;
        name: string;
        description?: string;
        targetType: PlanTargetType;
        materialCode?: string;
        allowedOrigins?: LotOrigin[];
        samplingRule: SamplingRule;
    }): InspectionPlan;
    static rehydrate(tenantId: TenantId, props: InspectionPlanProps, existing: Partial<EntityProps>): InspectionPlan;
    get planCode(): string;
    get status(): PlanStatus;
    get revision(): number;
    get materialCode(): string | undefined;
    get samplingRule(): SamplingRule;
    get characteristics(): readonly InspectionCharacteristic[];
    private assertEditable;
    addCharacteristic(input: CharacteristicInput): InspectionCharacteristic;
    removeCharacteristic(characteristicId: Ulid): void;
    updateSamplingRule(rule: SamplingRule): void;
    activate(): void;
    retire(): void;
    /**
     * Creates the next revision as a new draft aggregate (copy-on-revise).
     * The current revision stays active until the new one is activated and
     * the old one explicitly retired by the application service.
     */
    createNextRevision(): InspectionPlan;
    allowsOrigin(origin: LotOrigin): boolean;
}
export {};
//# sourceMappingURL=inspection-plan.d.ts.map