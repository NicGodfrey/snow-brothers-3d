import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { isoDate } from "./calendar.js";
import { SupplyChainEvents } from "./events.js";
import { assertQty } from "./types.js";
/**
 * A hard reservation of supply against a specific demand (usually a sales
 * order line). Active allocations are the committed demand side of ATP and
 * are treated as gross requirements by MRP, consuming the forecast of their
 * week.
 */
export class Allocation extends AggregateRoot {
    static create(tenantId, input) {
        const sku = input.sku?.trim().toUpperCase();
        if (!sku)
            throw new DomainError("Allocation SKU is required", "VALIDATION");
        const demandRef = input.demandRef?.trim();
        if (!demandRef)
            throw new DomainError("demandRef is required", "VALIDATION");
        const refType = input.demandRefType ?? "SALES_ORDER";
        if (!["SALES_ORDER", "TRANSFER_ORDER", "MANUAL"].includes(refType)) {
            throw new DomainError(`Invalid demandRefType: ${String(refType)}`, "VALIDATION");
        }
        const allocation = new Allocation(tenantId, {
            sku,
            location: input.location,
            qty: assertQty("qty", input.qty, { allowZero: false }),
            needDate: isoDate(input.needDate),
            demandRefType: refType,
            demandRef,
            status: "ACTIVE",
        });
        const payload = {
            allocationId: allocation.id,
            sku,
            location: input.location,
            qty: allocation.props.qty,
            needDate: allocation.props.needDate,
            demandRefType: refType,
            demandRef,
        };
        allocation.raise(envelope({
            eventType: SupplyChainEvents.AllocationCreated,
            aggregateType: "Allocation",
            aggregateId: allocation.id,
            tenantId,
            payload,
        }));
        return allocation;
    }
    get sku() {
        return this.props.sku;
    }
    get location() {
        return this.props.location;
    }
    get qty() {
        return this.props.qty;
    }
    get needDate() {
        return this.props.needDate;
    }
    get status() {
        return this.props.status;
    }
    cancel() {
        if (this.props.status !== "ACTIVE") {
            throw new DomainError(`Allocation is ${this.props.status}; only ACTIVE allocations can be cancelled`, "CONFLICT", 409);
        }
        this.props = { ...this.props, status: "CANCELLED" };
        this.raise(envelope({
            eventType: SupplyChainEvents.AllocationCancelled,
            aggregateType: "Allocation",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { allocationId: this.id, sku: this.props.sku, location: this.props.location, qty: this.props.qty },
        }));
    }
    fulfill() {
        if (this.props.status !== "ACTIVE") {
            throw new DomainError(`Allocation is ${this.props.status}; only ACTIVE allocations can be fulfilled`, "CONFLICT", 409);
        }
        this.props = { ...this.props, status: "FULFILLED" };
        this.touch();
    }
}
//# sourceMappingURL=allocation.js.map