import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
import { type WorkCenterId } from "./ids.js";
export declare const ROUTING_STATUSES: readonly ["DRAFT", "RELEASED", "OBSOLETE"];
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];
/**
 * One step in the manufacturing process. Sequences are conventionally
 * 10, 20, 30… so steps can be inserted later without renumbering.
 */
export interface RoutingOperation {
    readonly seq: number;
    readonly description: string;
    readonly workCenterId: WorkCenterId;
    /** One-time setup regardless of quantity. */
    readonly setupMinutes: number;
    /** Per-unit processing time. */
    readonly runMinutesPerUnit: number;
    /** One-time teardown/cleanup after the run. */
    readonly teardownMinutes: number;
    /** Wait time before the operation can start at the work center. */
    readonly queueMinutes: number;
    /** Transfer time to the next operation. */
    readonly moveMinutes: number;
    /** Whether QMS inspection is required before the next operation. */
    readonly inspectionRequired: boolean;
    /** Number of operators the operation occupies (for labor costing). */
    readonly crewSize: number;
}
export interface RoutingProps {
    sku: string;
    revision: string;
    description: string | null;
    status: RoutingStatus;
    operations: RoutingOperation[];
    releasedAt: string | null;
}
export interface OperationInput {
    seq: number;
    description: string;
    workCenterId: WorkCenterId;
    setupMinutes?: number;
    runMinutesPerUnit: number;
    teardownMinutes?: number;
    queueMinutes?: number;
    moveMinutes?: number;
    inspectionRequired?: boolean;
    crewSize?: number;
}
export declare class Routing extends AggregateRoot<RoutingProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        sku: string;
        revision?: string;
        description?: string;
    }): Routing;
    get sku(): string;
    get revision(): string;
    get status(): RoutingStatus;
    get operations(): readonly RoutingOperation[];
    private assertDraft;
    private static validateOperation;
    addOperation(input: OperationInput): void;
    updateOperation(seq: number, patch: Partial<Omit<OperationInput, "seq">>): void;
    removeOperation(seq: number): void;
    release(): void;
    makeObsolete(): void;
    /**
     * Naive lead time: sum of queue + setup + run*qty + teardown + move over
     * all operations. Scheduling against a calendar refines this; this figure
     * is used for quick ATP-style estimates.
     */
    estimateLeadTimeMinutes(quantity: number): number;
}
//# sourceMappingURL=routing.d.ts.map