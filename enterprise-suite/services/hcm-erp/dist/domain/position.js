import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "./events.js";
/** Individual-contributor and management grade ladders. */
export const GRADES = ["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "M1", "M2", "M3", "M4", "M5"];
export class Position extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static open(tenantId, input) {
        if (!input.title.trim())
            throw new DomainError("Position title is required", "INVALID_POSITION");
        if (!GRADES.includes(input.grade)) {
            throw new DomainError(`Unknown grade "${input.grade}"`, "INVALID_GRADE");
        }
        const fte = input.fte ?? 1;
        if (fte <= 0 || fte > 1) {
            throw new DomainError(`FTE must be in (0, 1], got ${fte}`, "INVALID_FTE");
        }
        const position = new Position(tenantId, {
            orgUnitId: input.orgUnitId,
            title: input.title.trim(),
            jobFamily: input.jobFamily.trim() || "general",
            grade: input.grade,
            fte,
            reportsToPositionId: input.reportsToPositionId,
            status: "open",
        });
        position.raise(envelope({
            eventType: HcmEvents.PositionOpened,
            aggregateType: "Position",
            aggregateId: position.id,
            tenantId,
            payload: { orgUnitId: input.orgUnitId, title: position.props.title, grade: input.grade },
        }));
        return position;
    }
    get orgUnitId() {
        return this.props.orgUnitId;
    }
    get title() {
        return this.props.title;
    }
    get grade() {
        return this.props.grade;
    }
    get status() {
        return this.props.status;
    }
    get currentEmployeeId() {
        return this.props.currentEmployeeId;
    }
    get reportsToPositionId() {
        return this.props.reportsToPositionId;
    }
    get fte() {
        return this.props.fte;
    }
    isFillable() {
        return this.props.status === "open";
    }
    fill(employeeId) {
        if (this.props.status !== "open") {
            throw new DomainError(`Position "${this.props.title}" cannot be filled from status ${this.props.status}`, "POSITION_NOT_OPEN", 409);
        }
        this.props.status = "filled";
        this.props.currentEmployeeId = employeeId;
        this.raise(envelope({
            eventType: HcmEvents.PositionFilled,
            aggregateType: "Position",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { positionId: this.id, employeeId, orgUnitId: this.props.orgUnitId },
        }));
    }
    vacate() {
        if (this.props.status !== "filled") {
            throw new DomainError(`Position "${this.props.title}" is not filled and cannot be vacated`, "POSITION_NOT_FILLED", 409);
        }
        const previousEmployeeId = this.props.currentEmployeeId;
        this.props.status = "open";
        this.props.currentEmployeeId = undefined;
        this.raise(envelope({
            eventType: HcmEvents.PositionVacated,
            aggregateType: "Position",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { positionId: this.id, previousEmployeeId },
        }));
    }
    freeze(reason) {
        if (this.props.status !== "open") {
            throw new DomainError(`Only open positions can be frozen (status: ${this.props.status})`, "POSITION_NOT_OPEN", 409);
        }
        this.props.status = "frozen";
        this.raise(envelope({
            eventType: HcmEvents.PositionFrozen,
            aggregateType: "Position",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { reason },
        }));
    }
    unfreeze() {
        if (this.props.status !== "frozen") {
            throw new DomainError(`Position is not frozen (status: ${this.props.status})`, "POSITION_NOT_FROZEN", 409);
        }
        this.props.status = "open";
        this.raise(envelope({
            eventType: HcmEvents.PositionUnfrozen,
            aggregateType: "Position",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {},
        }));
    }
    eliminate() {
        if (this.props.status === "filled") {
            throw new DomainError("A filled position must be vacated before elimination", "POSITION_FILLED", 409);
        }
        if (this.props.status === "eliminated") {
            throw new DomainError("Position is already eliminated", "ALREADY_ELIMINATED", 409);
        }
        this.props.status = "eliminated";
        this.raise(envelope({
            eventType: HcmEvents.PositionEliminated,
            aggregateType: "Position",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { title: this.props.title, orgUnitId: this.props.orgUnitId },
        }));
    }
    changeReportsTo(reportsToPositionId) {
        if (reportsToPositionId === this.id) {
            throw new DomainError("A position cannot report to itself", "POSITION_SELF_REPORT");
        }
        if (this.props.status === "eliminated") {
            throw new DomainError("Cannot modify an eliminated position", "POSITION_ELIMINATED", 409);
        }
        this.props.reportsToPositionId = reportsToPositionId;
        this.touch();
    }
}
//# sourceMappingURL=position.js.map