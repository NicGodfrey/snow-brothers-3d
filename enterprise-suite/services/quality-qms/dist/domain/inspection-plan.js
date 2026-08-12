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
import { AggregateRoot, ConflictError, DomainError, envelope, newId, } from "@enterprise-suite/shared-kernel";
import { QualityEventTypes } from "./events.js";
import { validateSamplingRule } from "./sampling.js";
export class InspectionPlan extends AggregateRoot {
    constructor(tenantId, props, existing) {
        super(tenantId, props, existing);
    }
    static create(tenantId, input) {
        if (!input.planCode.trim())
            throw new DomainError("planCode is required", "VALIDATION");
        if (!input.name.trim())
            throw new DomainError("name is required", "VALIDATION");
        if (input.targetType !== "process" && !input.materialCode?.trim()) {
            throw new DomainError(`materialCode is required for targetType '${input.targetType}'`, "VALIDATION");
        }
        validateSamplingRule(input.samplingRule);
        const plan = new InspectionPlan(tenantId, {
            planCode: input.planCode.trim().toUpperCase(),
            name: input.name.trim(),
            description: input.description,
            targetType: input.targetType,
            materialCode: input.materialCode?.trim(),
            revision: 1,
            status: "draft",
            allowedOrigins: input.allowedOrigins ?? [],
            samplingRule: input.samplingRule,
            characteristics: [],
        });
        plan.raise(envelope({
            eventType: QualityEventTypes.InspectionPlanCreated,
            aggregateType: "InspectionPlan",
            aggregateId: plan.id,
            tenantId,
            payload: { planCode: plan.props.planCode, revision: 1, targetType: input.targetType },
        }));
        return plan;
    }
    static rehydrate(tenantId, props, existing) {
        return new InspectionPlan(tenantId, props, existing);
    }
    get planCode() { return this.props.planCode; }
    get status() { return this.props.status; }
    get revision() { return this.props.revision; }
    get materialCode() { return this.props.materialCode; }
    get samplingRule() { return this.props.samplingRule; }
    get characteristics() { return this.props.characteristics; }
    assertEditable() {
        if (this.props.status !== "draft") {
            throw new ConflictError(`Inspection plan ${this.props.planCode} rev ${this.props.revision} is '${this.props.status}'; only draft plans are editable`);
        }
    }
    addCharacteristic(input) {
        this.assertEditable();
        validateCharacteristic(input);
        if (this.props.characteristics.some((c) => c.code === input.code.trim().toUpperCase())) {
            throw new ConflictError(`Characteristic code '${input.code}' already exists on plan`);
        }
        const characteristic = {
            id: newId("char"),
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            type: input.type,
            criticality: input.criticality,
            method: input.method,
            quantitative: input.type === "quantitative" ? input.quantitative : undefined,
            sampleSizeOverride: input.sampleSizeOverride,
        };
        this.props.characteristics.push(characteristic);
        this.touch();
        return characteristic;
    }
    removeCharacteristic(characteristicId) {
        this.assertEditable();
        const idx = this.props.characteristics.findIndex((c) => c.id === characteristicId);
        if (idx === -1)
            throw new DomainError(`Characteristic ${characteristicId} not on plan`, "NOT_FOUND", 404);
        this.props.characteristics.splice(idx, 1);
        this.touch();
    }
    updateSamplingRule(rule) {
        this.assertEditable();
        validateSamplingRule(rule);
        this.props.samplingRule = rule;
        this.touch();
    }
    activate() {
        if (this.props.status === "active")
            return; // idempotent
        this.assertEditable();
        if (this.props.characteristics.length === 0) {
            throw new ConflictError("Cannot activate a plan without characteristics");
        }
        this.props.status = "active";
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionPlanActivated,
            aggregateType: "InspectionPlan",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                planCode: this.props.planCode,
                revision: this.props.revision,
                characteristicCount: this.props.characteristics.length,
            },
        }));
    }
    retire() {
        if (this.props.status !== "active") {
            throw new ConflictError(`Only active plans can be retired (status: ${this.props.status})`);
        }
        this.props.status = "retired";
        this.raise(envelope({
            eventType: QualityEventTypes.InspectionPlanRetired,
            aggregateType: "InspectionPlan",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { planCode: this.props.planCode, revision: this.props.revision },
        }));
    }
    /**
     * Creates the next revision as a new draft aggregate (copy-on-revise).
     * The current revision stays active until the new one is activated and
     * the old one explicitly retired by the application service.
     */
    createNextRevision() {
        if (this.props.status !== "active") {
            throw new ConflictError("Only active plans can be revised");
        }
        const next = new InspectionPlan(this.tenantId, {
            planCode: this.props.planCode,
            name: this.props.name,
            description: this.props.description,
            targetType: this.props.targetType,
            materialCode: this.props.materialCode,
            revision: this.props.revision + 1,
            status: "draft",
            allowedOrigins: [...this.props.allowedOrigins],
            samplingRule: this.props.samplingRule,
            characteristics: this.props.characteristics.map((c) => ({ ...c, id: newId("char") })),
        });
        next.raise(envelope({
            eventType: QualityEventTypes.InspectionPlanRevised,
            aggregateType: "InspectionPlan",
            aggregateId: next.id,
            tenantId: this.tenantId,
            payload: {
                planCode: this.props.planCode,
                fromRevision: this.props.revision,
                toRevision: next.props.revision,
                previousPlanId: this.id,
            },
        }));
        return next;
    }
    allowsOrigin(origin) {
        return this.props.allowedOrigins.length === 0 || this.props.allowedOrigins.includes(origin);
    }
}
function validateCharacteristic(input) {
    if (!input.code.trim())
        throw new DomainError("characteristic code is required", "VALIDATION");
    if (!input.name.trim())
        throw new DomainError("characteristic name is required", "VALIDATION");
    if (input.type === "quantitative") {
        const spec = input.quantitative;
        if (!spec) {
            throw new DomainError("quantitative characteristics require a spec", "VALIDATION");
        }
        if (!spec.unit.trim())
            throw new DomainError("quantitative spec requires a unit", "VALIDATION");
        if (spec.lowerLimit === undefined && spec.upperLimit === undefined && spec.target === undefined) {
            throw new DomainError("quantitative spec needs at least one of lowerLimit/upperLimit/target", "VALIDATION");
        }
        if (spec.lowerLimit !== undefined &&
            spec.upperLimit !== undefined &&
            spec.lowerLimit >= spec.upperLimit) {
            throw new DomainError("lowerLimit must be < upperLimit", "VALIDATION");
        }
    }
    if (input.sampleSizeOverride !== undefined) {
        if (!Number.isInteger(input.sampleSizeOverride) || input.sampleSizeOverride < 1) {
            throw new DomainError("sampleSizeOverride must be a positive integer", "VALIDATION");
        }
    }
}
//# sourceMappingURL=inspection-plan.js.map