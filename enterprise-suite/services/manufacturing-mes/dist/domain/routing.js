import { AggregateRoot, ConflictError, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";
export const ROUTING_STATUSES = ["DRAFT", "RELEASED", "OBSOLETE"];
export class Routing extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static create(tenantId, input) {
        if (!input.sku.trim()) {
            throw new DomainError("Routing requires a product SKU", "ROUTING_INVALID_SKU");
        }
        const routing = new Routing(tenantId, {
            sku: input.sku.trim().toUpperCase(),
            revision: input.revision?.trim() || "A",
            description: input.description?.trim() || null,
            status: "DRAFT",
            operations: [],
            releasedAt: null,
        });
        routing.raise(envelope({
            eventType: MesEvents.RoutingCreated,
            aggregateType: "Routing",
            aggregateId: asUlid(routing.id),
            tenantId,
            payload: { sku: routing.props.sku, revision: routing.props.revision },
        }));
        return routing;
    }
    get sku() {
        return this.props.sku;
    }
    get revision() {
        return this.props.revision;
    }
    get status() {
        return this.props.status;
    }
    get operations() {
        return this.props.operations;
    }
    assertDraft(action) {
        if (this.props.status !== "DRAFT") {
            throw new ConflictError(`Cannot ${action}: routing ${this.props.sku}/${this.props.revision} is ${this.props.status}`);
        }
    }
    static validateOperation(input) {
        if (!Number.isInteger(input.seq) || input.seq < 1) {
            throw new DomainError("Operation seq must be a positive integer", "ROUTING_INVALID_SEQ");
        }
        if (!input.description.trim()) {
            throw new DomainError("Operation description is required", "ROUTING_INVALID_OP");
        }
        if (input.runMinutesPerUnit < 0) {
            throw new DomainError("runMinutesPerUnit must be >= 0", "ROUTING_INVALID_TIME");
        }
        const setup = input.setupMinutes ?? 0;
        const teardown = input.teardownMinutes ?? 0;
        const queue = input.queueMinutes ?? 0;
        const move = input.moveMinutes ?? 0;
        if (setup < 0 || teardown < 0 || queue < 0 || move < 0) {
            throw new DomainError("Operation times must be >= 0", "ROUTING_INVALID_TIME");
        }
        if (setup + input.runMinutesPerUnit + teardown === 0) {
            throw new DomainError("Operation must have some setup, run, or teardown time", "ROUTING_ZERO_TIME");
        }
        const crewSize = input.crewSize ?? 1;
        if (!Number.isInteger(crewSize) || crewSize < 0) {
            throw new DomainError("crewSize must be a non-negative integer", "ROUTING_INVALID_CREW");
        }
        return {
            seq: input.seq,
            description: input.description.trim(),
            workCenterId: input.workCenterId,
            setupMinutes: setup,
            runMinutesPerUnit: input.runMinutesPerUnit,
            teardownMinutes: teardown,
            queueMinutes: queue,
            moveMinutes: move,
            inspectionRequired: input.inspectionRequired ?? false,
            crewSize,
        };
    }
    addOperation(input) {
        this.assertDraft("add operation");
        if (this.props.operations.some((op) => op.seq === input.seq)) {
            throw new ConflictError(`Operation seq ${input.seq} already exists on routing`);
        }
        this.props.operations.push(Routing.validateOperation(input));
        this.props.operations.sort((a, b) => a.seq - b.seq);
        this.raise(envelope({
            eventType: MesEvents.RoutingOperationAdded,
            aggregateType: "Routing",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { sku: this.props.sku, seq: input.seq },
        }));
    }
    updateOperation(seq, patch) {
        this.assertDraft("update operation");
        const existing = this.props.operations.find((op) => op.seq === seq);
        if (!existing) {
            throw new DomainError(`No operation with seq ${seq}`, "ROUTING_OP_NOT_FOUND", 404);
        }
        const merged = Routing.validateOperation({
            seq,
            description: patch.description ?? existing.description,
            workCenterId: patch.workCenterId ?? existing.workCenterId,
            setupMinutes: patch.setupMinutes ?? existing.setupMinutes,
            runMinutesPerUnit: patch.runMinutesPerUnit ?? existing.runMinutesPerUnit,
            teardownMinutes: patch.teardownMinutes ?? existing.teardownMinutes,
            queueMinutes: patch.queueMinutes ?? existing.queueMinutes,
            moveMinutes: patch.moveMinutes ?? existing.moveMinutes,
            inspectionRequired: patch.inspectionRequired ?? existing.inspectionRequired,
            crewSize: patch.crewSize ?? existing.crewSize,
        });
        const idx = this.props.operations.findIndex((op) => op.seq === seq);
        this.props.operations[idx] = merged;
        this.raise(envelope({
            eventType: MesEvents.RoutingOperationUpdated,
            aggregateType: "Routing",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { sku: this.props.sku, seq },
        }));
    }
    removeOperation(seq) {
        this.assertDraft("remove operation");
        const idx = this.props.operations.findIndex((op) => op.seq === seq);
        if (idx === -1) {
            throw new DomainError(`No operation with seq ${seq}`, "ROUTING_OP_NOT_FOUND", 404);
        }
        this.props.operations.splice(idx, 1);
        this.raise(envelope({
            eventType: MesEvents.RoutingOperationRemoved,
            aggregateType: "Routing",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { sku: this.props.sku, seq },
        }));
    }
    release() {
        this.assertDraft("release");
        if (this.props.operations.length === 0) {
            throw new DomainError("Cannot release a routing with no operations", "ROUTING_EMPTY_RELEASE", 422);
        }
        this.props.status = "RELEASED";
        this.props.releasedAt = new Date().toISOString();
        this.raise(envelope({
            eventType: MesEvents.RoutingReleased,
            aggregateType: "Routing",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: {
                sku: this.props.sku,
                revision: this.props.revision,
                operationCount: this.props.operations.length,
            },
        }));
    }
    makeObsolete() {
        if (this.props.status === "OBSOLETE")
            return;
        if (this.props.status === "DRAFT") {
            throw new ConflictError("Draft routings should be deleted, not obsoleted");
        }
        this.props.status = "OBSOLETE";
        this.raise(envelope({
            eventType: MesEvents.RoutingObsoleted,
            aggregateType: "Routing",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { sku: this.props.sku, revision: this.props.revision },
        }));
    }
    /**
     * Naive lead time: sum of queue + setup + run*qty + teardown + move over
     * all operations. Scheduling against a calendar refines this; this figure
     * is used for quick ATP-style estimates.
     */
    estimateLeadTimeMinutes(quantity) {
        if (quantity <= 0) {
            throw new DomainError("Quantity must be positive", "ROUTING_INVALID_QTY");
        }
        return this.props.operations.reduce((sum, op) => sum +
            op.queueMinutes +
            op.setupMinutes +
            op.runMinutesPerUnit * quantity +
            op.teardownMinutes +
            op.moveMinutes, 0);
    }
}
//# sourceMappingURL=routing.js.map