import { AggregateRoot, DomainError, envelope, money, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";
export const WORK_CENTER_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE"];
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9\-_]{1,31}$/;
export class WorkCenter extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static create(tenantId, input) {
        const code = input.code.trim().toUpperCase();
        if (!CODE_PATTERN.test(code)) {
            throw new DomainError(`Work center code '${input.code}' must match ${CODE_PATTERN}`, "WORK_CENTER_INVALID_CODE");
        }
        if (!input.name.trim()) {
            throw new DomainError("Work center name is required", "WORK_CENTER_INVALID_NAME");
        }
        const machineCount = input.machineCount ?? 1;
        if (!Number.isInteger(machineCount) || machineCount < 1) {
            throw new DomainError("machineCount must be a positive integer", "WORK_CENTER_INVALID_MACHINES");
        }
        const efficiencyPct = input.efficiencyPct ?? 85;
        const utilizationPct = input.utilizationPct ?? 90;
        for (const [label, pct] of [
            ["efficiencyPct", efficiencyPct],
            ["utilizationPct", utilizationPct],
        ]) {
            if (pct <= 0 || pct > 100) {
                throw new DomainError(`${label} must be in (0, 100]`, "WORK_CENTER_INVALID_PCT");
            }
        }
        const currency = input.currency ?? "USD";
        const wc = new WorkCenter(tenantId, {
            code,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            costCenterCode: input.costCenterCode?.trim() || null,
            status: "ACTIVE",
            machineCount,
            efficiencyPct,
            utilizationPct,
            defaultQueueMinutes: input.defaultQueueMinutes ?? 0,
            rates: {
                laborRatePerHour: money(input.laborRatePerHourMinor ?? 0, currency),
                machineRatePerHour: money(input.machineRatePerHourMinor ?? 0, currency),
                overheadRatePerHour: money(input.overheadRatePerHourMinor ?? 0, currency),
            },
            calendarId: null,
            tags: input.tags ?? [],
        });
        wc.raise(envelope({
            eventType: MesEvents.WorkCenterCreated,
            aggregateType: "WorkCenter",
            aggregateId: asUlid(wc.id),
            tenantId,
            payload: { code: wc.props.code, name: wc.props.name },
        }));
        return wc;
    }
    get code() {
        return this.props.code;
    }
    get status() {
        return this.props.status;
    }
    get calendarId() {
        return this.props.calendarId;
    }
    get machineCount() {
        return this.props.machineCount;
    }
    get rates() {
        return this.props.rates;
    }
    get defaultQueueMinutes() {
        return this.props.defaultQueueMinutes;
    }
    /**
     * Effective capacity factor applied to raw calendar minutes:
     * machines * efficiency * utilization.
     */
    capacityFactor() {
        return (this.props.machineCount *
            (this.props.efficiencyPct / 100) *
            (this.props.utilizationPct / 100));
    }
    isLoadable() {
        return this.props.status === "ACTIVE";
    }
    update(patch) {
        if (patch.name !== undefined) {
            if (!patch.name.trim()) {
                throw new DomainError("Work center name is required", "WORK_CENTER_INVALID_NAME");
            }
            this.props.name = patch.name.trim();
        }
        if (patch.description !== undefined)
            this.props.description = patch.description;
        if (patch.costCenterCode !== undefined)
            this.props.costCenterCode = patch.costCenterCode;
        if (patch.machineCount !== undefined) {
            if (!Number.isInteger(patch.machineCount) || patch.machineCount < 1) {
                throw new DomainError("machineCount must be a positive integer", "WORK_CENTER_INVALID_MACHINES");
            }
            this.props.machineCount = patch.machineCount;
        }
        if (patch.efficiencyPct !== undefined) {
            if (patch.efficiencyPct <= 0 || patch.efficiencyPct > 100) {
                throw new DomainError("efficiencyPct must be in (0, 100]", "WORK_CENTER_INVALID_PCT");
            }
            this.props.efficiencyPct = patch.efficiencyPct;
        }
        if (patch.utilizationPct !== undefined) {
            if (patch.utilizationPct <= 0 || patch.utilizationPct > 100) {
                throw new DomainError("utilizationPct must be in (0, 100]", "WORK_CENTER_INVALID_PCT");
            }
            this.props.utilizationPct = patch.utilizationPct;
        }
        if (patch.defaultQueueMinutes !== undefined) {
            if (patch.defaultQueueMinutes < 0) {
                throw new DomainError("defaultQueueMinutes must be >= 0", "WORK_CENTER_INVALID_QUEUE");
            }
            this.props.defaultQueueMinutes = patch.defaultQueueMinutes;
        }
        if (patch.tags !== undefined)
            this.props.tags = patch.tags;
        this.raise(envelope({
            eventType: MesEvents.WorkCenterUpdated,
            aggregateType: "WorkCenter",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { code: this.props.code },
        }));
    }
    setRates(rates) {
        const currencies = new Set([
            rates.laborRatePerHour.currency,
            rates.machineRatePerHour.currency,
            rates.overheadRatePerHour.currency,
        ]);
        if (currencies.size !== 1) {
            throw new DomainError("All work center rates must share one currency", "WORK_CENTER_RATE_CURRENCY");
        }
        this.props.rates = rates;
        this.raise(envelope({
            eventType: MesEvents.WorkCenterUpdated,
            aggregateType: "WorkCenter",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { code: this.props.code, ratesChanged: true },
        }));
    }
    changeStatus(next, reason) {
        if (next === this.props.status)
            return;
        const previous = this.props.status;
        this.props.status = next;
        this.raise(envelope({
            eventType: MesEvents.WorkCenterStatusChanged,
            aggregateType: "WorkCenter",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { code: this.props.code, previous, next, reason: reason ?? null },
        }));
    }
    assignCalendar(calendarId) {
        this.props.calendarId = calendarId;
        this.raise(envelope({
            eventType: MesEvents.WorkCenterUpdated,
            aggregateType: "WorkCenter",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: { code: this.props.code, calendarId },
        }));
    }
}
//# sourceMappingURL=work-center.js.map