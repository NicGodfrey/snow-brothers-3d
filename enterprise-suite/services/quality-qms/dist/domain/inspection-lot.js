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
import { AggregateRoot, ConflictError, DomainError, envelope, nowIso, } from "@enterprise-suite/shared-kernel";
import { QualityEventTypes } from "./events.js";
import { StateMachine } from "./state-machine.js";
import { computeStatistics } from "./statistics.js";
const lotMachine = new StateMachine("InspectionLot", [
    { from: "created", to: "in-progress" },
    {
        from: "in-progress",
        to: "completed",
        guard: (lot) => {
            const missing = lot.missingCharacteristicCodes();
            return missing.length > 0
                ? `results missing for characteristics: ${missing.join(", ")}`
                : undefined;
        },
    },
    { from: "completed", to: "decided" },
    { from: ["created", "in-progress"], to: "cancelled" },
], ["decided", "cancelled"]);
export class InspectionLot extends AggregateRoot {
    constructor(tenantId, props, existing) {
        super(tenantId, props, existing);
    }
    static create(tenantId, input) {
        if (input.quantity <= 0)
            throw new DomainError("Lot quantity must be positive", "VALIDATION");
        if (!input.uom.trim())
            throw new DomainError("uom is required", "VALIDATION");
        if (input.characteristics.length === 0) {
            throw new DomainError("Cannot create a lot from a plan without characteristics", "VALIDATION");
        }
        if (input.origin === "goods-receipt" && !input.linkage?.supplierId) {
            throw new DomainError("goods-receipt lots require linkage.supplierId", "VALIDATION");
        }
        const lot = new InspectionLot(tenantId, {
            lotNumber: input.lotNumber,
            planId: input.planId,
            planCode: input.planCode,
            planRevision: input.planRevision,
            origin: input.origin,
            materialCode: input.materialCode,
            quantity: input.quantity,
            uom: input.uom.trim(),
            linkage: input.linkage ?? {},
            sampling: input.sampling,
            characteristics: [...input.characteristics],
            status: "created",
            results: [],
        });
        lot.raise(envelope({
            eventType: QualityEventTypes.InspectionLotCreated,
            aggregateType: "InspectionLot",
            aggregateId: lot.id,
            tenantId,
            payload: {
                lotNumber: lot.props.lotNumber,
                planId: input.planId,
                origin: input.origin,
                materialCode: input.materialCode,
                quantity: input.quantity,
                sampleSize: input.sampling.sampleSize,
                supplierId: input.linkage?.supplierId,
            },
        }));
        return lot;
    }
    static rehydrate(tenantId, props, existing) {
        return new InspectionLot(tenantId, props, existing);
    }
    get lotNumber() { return this.props.lotNumber; }
    get status() { return this.props.status; }
    get origin() { return this.props.origin; }
    get planId() { return this.props.planId; }
    get materialCode() { return this.props.materialCode; }
    get quantity() { return this.props.quantity; }
    get uom() { return this.props.uom; }
    get linkage() { return this.props.linkage; }
    get sampling() { return this.props.sampling; }
    get results() { return this.props.results; }
    get usageDecision() { return this.props.usageDecision; }
    get characteristics() { return this.props.characteristics; }
    missingCharacteristicCodes() {
        const recorded = new Set(this.props.results.map((r) => r.characteristicId));
        return this.props.characteristics.filter((c) => !recorded.has(c.id)).map((c) => c.code);
    }
    failedResults() {
        return this.props.results.filter((r) => r.evaluation === "fail");
    }
    hasCriticalFailure() {
        return this.failedResults().some((r) => r.criticality === "critical");
    }
    start() {
        this.props.status = lotMachine.assertTransition(this.props.status, "in-progress", this);
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionLotStarted,
            aggregateType: "InspectionLot",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { lotNumber: this.props.lotNumber },
        }));
    }
    recordQuantitativeResult(characteristicCode, input, recordedBy, note) {
        const characteristic = this.characteristicForRecording(characteristicCode, "quantitative");
        if (input.readings.length === 0) {
            throw new DomainError("At least one reading is required", "VALIDATION");
        }
        const expected = characteristic.sampleSizeOverride ?? this.props.sampling.sampleSize;
        if (input.readings.length > expected) {
            throw new DomainError(`Received ${input.readings.length} readings but sample size is ${expected}`, "VALIDATION");
        }
        const spec = characteristic.quantitative;
        const statistics = computeStatistics(input.readings, spec.lowerLimit, spec.upperLimit);
        const evaluation = statistics.outOfSpecCount === 0 ? "pass" : "fail";
        return this.pushResult({
            characteristicId: characteristic.id,
            code: characteristic.code,
            type: "quantitative",
            criticality: characteristic.criticality,
            readings: [...input.readings],
            statistics,
            evaluation,
            note,
            recordedBy,
            recordedAt: nowIso(),
        });
    }
    recordAttributeResult(characteristicCode, input, recordedBy, note) {
        const characteristic = this.characteristicForRecording(characteristicCode, "attribute");
        if (!Number.isInteger(input.inspected) || input.inspected < 1) {
            throw new DomainError("inspected must be a positive integer", "VALIDATION");
        }
        if (!Number.isInteger(input.defective) || input.defective < 0 || input.defective > input.inspected) {
            throw new DomainError("defective must be an integer in [0, inspected]", "VALIDATION");
        }
        // Critical characteristics never tolerate defects, regardless of the
        // lot-level acceptance number from the sampling plan.
        const acceptance = characteristic.criticality === "critical" ? 0 : this.props.sampling.acceptanceNumber;
        const evaluation = input.defective <= acceptance ? "pass" : "fail";
        return this.pushResult({
            characteristicId: characteristic.id,
            code: characteristic.code,
            type: "attribute",
            criticality: characteristic.criticality,
            attribute: { inspected: input.inspected, defective: input.defective },
            evaluation,
            note,
            recordedBy,
            recordedAt: nowIso(),
        });
    }
    characteristicForRecording(code, expectedType) {
        if (this.props.status !== "in-progress") {
            throw new ConflictError(`Results can only be recorded while in-progress (status: ${this.props.status})`);
        }
        const normalized = code.trim().toUpperCase();
        const characteristic = this.props.characteristics.find((c) => c.code === normalized);
        if (!characteristic) {
            throw new DomainError(`Characteristic '${code}' is not on this lot`, "NOT_FOUND", 404);
        }
        if (characteristic.type !== expectedType) {
            throw new DomainError(`Characteristic '${code}' is ${characteristic.type}, not ${expectedType}`, "VALIDATION");
        }
        if (this.props.results.some((r) => r.characteristicId === characteristic.id)) {
            throw new ConflictError(`Result for characteristic '${code}' already recorded`);
        }
        return characteristic;
    }
    pushResult(result) {
        this.props.results.push(result);
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionResultRecorded,
            aggregateType: "InspectionLot",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                lotNumber: this.props.lotNumber,
                characteristicCode: result.code,
                evaluation: result.evaluation,
                criticality: result.criticality,
            },
        }));
        return result;
    }
    complete() {
        this.props.status = lotMachine.assertTransition(this.props.status, "completed", this);
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionLotCompleted,
            aggregateType: "InspectionLot",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                lotNumber: this.props.lotNumber,
                failedCharacteristicCodes: this.failedResults().map((r) => r.code),
            },
        }));
    }
    decide(decision, decidedBy, options) {
        lotMachine.assertTransition(this.props.status, "decided", this);
        const failed = this.failedResults();
        if (decision === "accept" && failed.length > 0) {
            throw new ConflictError(`Cannot plainly accept: characteristics failed (${failed.map((r) => r.code).join(", ")}). ` +
                "Use accept-with-deviation, partial, or reject.");
        }
        if (decision === "accept-with-deviation") {
            if (failed.length === 0) {
                throw new ConflictError("accept-with-deviation requires at least one failed characteristic");
            }
            if (this.hasCriticalFailure()) {
                throw new ConflictError("Lots with failed CRITICAL characteristics cannot be accepted with deviation; reject or use partial");
            }
            if (!options?.note?.trim()) {
                throw new DomainError("accept-with-deviation requires a justification note", "VALIDATION");
            }
        }
        if (decision === "reject" && failed.length === 0 && !options?.note?.trim()) {
            throw new DomainError("Rejecting a lot with no failed characteristics requires a justification note", "VALIDATION");
        }
        let acceptedQuantity;
        let rejectedQuantity;
        switch (decision) {
            case "accept":
            case "accept-with-deviation":
                acceptedQuantity = this.props.quantity;
                rejectedQuantity = 0;
                break;
            case "reject":
                acceptedQuantity = 0;
                rejectedQuantity = this.props.quantity;
                break;
            case "partial": {
                const accepted = options?.acceptedQuantity;
                if (accepted === undefined || accepted <= 0 || accepted >= this.props.quantity) {
                    throw new DomainError("partial decision requires acceptedQuantity strictly between 0 and lot quantity", "VALIDATION");
                }
                acceptedQuantity = accepted;
                rejectedQuantity = this.props.quantity - accepted;
                break;
            }
        }
        const usage = {
            decision,
            acceptedQuantity,
            rejectedQuantity,
            note: options?.note,
            decidedBy,
            decidedAt: nowIso(),
        };
        this.props.usageDecision = usage;
        this.props.status = "decided";
        const payload = {
            lotNumber: this.props.lotNumber,
            planId: this.props.planId,
            origin: this.props.origin,
            materialCode: this.props.materialCode,
            decision,
            acceptedQuantity,
            rejectedQuantity,
            supplierId: this.props.linkage.supplierId,
            purchaseOrderRef: this.props.linkage.purchaseOrderRef,
            workOrderRef: this.props.linkage.workOrderRef,
            failedCharacteristicCodes: failed.map((r) => r.code),
        };
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionLotDecided,
            aggregateType: "InspectionLot",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload,
        }));
        this.touch();
        return usage;
    }
    cancel(reason) {
        if (!reason.trim())
            throw new DomainError("Cancellation reason is required", "VALIDATION");
        this.props.status = lotMachine.assertTransition(this.props.status, "cancelled", this);
        this.props.cancellationReason = reason.trim();
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionLotCancelled,
            aggregateType: "InspectionLot",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { lotNumber: this.props.lotNumber, reason: reason.trim() },
        }));
    }
}
//# sourceMappingURL=inspection-lot.js.map