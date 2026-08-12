import { AggregateRoot, DomainError, envelope, mulMoney, newId, } from "@enterprise-suite/shared-kernel";
import { SupplyChainEvents } from "./events.js";
/**
 * The persisted result of netting one item at one location in one planning
 * run: the full MRP grid, generated planned orders and exception messages.
 * Order lifecycle transitions happen here so the invariants (no firming a
 * released order, etc.) live with the data they protect.
 */
export class SupplyPlan extends AggregateRoot {
    static create(tenantId, input) {
        const orders = input.orders.map((order) => ({
            orderId: newId("po"),
            orderType: order.orderType,
            sku: input.sku,
            qty: order.qty,
            dueDate: order.dueDate,
            releaseDate: order.releaseDate,
            status: "PLANNED",
            supplierId: order.supplierId,
            estimatedCost: order.unitCost ? mulMoney(order.unitCost, order.qty) : null,
            pastDue: order.pastDue,
        }));
        const stats = {
            totalGrossRequirement: sum(input.rows.map((r) => r.grossRequirement)),
            totalPlannedQty: sum(orders.map((o) => o.qty)),
            orderCount: orders.length,
            exceptionCount: input.exceptions.length,
            endingOnHand: input.rows.at(-1)?.projectedOnHand ?? 0,
        };
        const plan = new SupplyPlan(tenantId, {
            runId: input.runId,
            sku: input.sku,
            location: input.location,
            horizonStart: input.horizonStart,
            weekCount: input.weekCount,
            safetyStock: input.safetyStock,
            rows: input.rows,
            orders,
            exceptions: input.exceptions,
            stats,
        });
        plan.raise(envelope({
            eventType: SupplyChainEvents.SupplyPlanCreated,
            aggregateType: "SupplyPlan",
            aggregateId: plan.id,
            tenantId,
            payload: {
                planId: plan.id,
                runId: input.runId,
                sku: input.sku,
                location: input.location,
                orderCount: orders.length,
                exceptionCount: input.exceptions.length,
            },
        }));
        return plan;
    }
    get runId() {
        return this.props.runId;
    }
    get sku() {
        return this.props.sku;
    }
    get location() {
        return this.props.location;
    }
    get rows() {
        return this.props.rows;
    }
    get orders() {
        return this.props.orders;
    }
    get exceptions() {
        return this.props.exceptions;
    }
    get stats() {
        return this.props.stats;
    }
    /** Orders the next planning run must respect as committed supply. */
    firmedOrders() {
        return this.props.orders.filter((o) => o.status === "FIRMED");
    }
    firmOrder(orderId) {
        const order = this.getOrder(orderId);
        if (order.status !== "PLANNED") {
            throw new DomainError(`Order ${orderId} is ${order.status}; only PLANNED orders can be firmed`, "CONFLICT", 409);
        }
        const updated = this.transition(orderId, "FIRMED");
        this.raise(envelope({
            eventType: SupplyChainEvents.PlannedOrderFirmed,
            aggregateType: "SupplyPlan",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { planId: this.id, orderId, sku: updated.sku, qty: updated.qty, dueDate: updated.dueDate },
        }));
        return updated;
    }
    releaseOrder(orderId) {
        const order = this.getOrder(orderId);
        if (order.status !== "PLANNED" && order.status !== "FIRMED") {
            throw new DomainError(`Order ${orderId} is ${order.status}; cannot release`, "CONFLICT", 409);
        }
        const updated = this.transition(orderId, "RELEASED");
        const payload = {
            planId: this.id,
            orderId,
            sku: updated.sku,
            location: this.props.location,
            orderType: updated.orderType,
            qty: updated.qty,
            dueDate: updated.dueDate,
            releaseDate: updated.releaseDate,
            supplierId: updated.supplierId,
        };
        this.raise(envelope({
            eventType: SupplyChainEvents.PlannedOrderReleased,
            aggregateType: "SupplyPlan",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload,
        }));
        return updated;
    }
    cancelOrder(orderId) {
        const order = this.getOrder(orderId);
        if (order.status === "RELEASED") {
            throw new DomainError(`Order ${orderId} is RELEASED; cancel it in the downstream system`, "CONFLICT", 409);
        }
        if (order.status === "CANCELLED") {
            throw new DomainError(`Order ${orderId} is already cancelled`, "CONFLICT", 409);
        }
        const updated = this.transition(orderId, "CANCELLED");
        this.raise(envelope({
            eventType: SupplyChainEvents.PlannedOrderCancelled,
            aggregateType: "SupplyPlan",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { planId: this.id, orderId, sku: updated.sku, qty: updated.qty },
        }));
        return updated;
    }
    getOrder(orderId) {
        const order = this.props.orders.find((o) => o.orderId === orderId);
        if (!order)
            throw new DomainError(`Planned order not found: ${orderId}`, "NOT_FOUND", 404);
        return order;
    }
    transition(orderId, status) {
        let updated;
        this.props = {
            ...this.props,
            orders: this.props.orders.map((o) => {
                if (o.orderId !== orderId)
                    return o;
                updated = { ...o, status };
                return updated;
            }),
        };
        this.touch();
        return updated;
    }
}
function sum(values) {
    return Math.round(values.reduce((s, v) => s + v, 0) * 1000) / 1000;
}
//# sourceMappingURL=supply-plan.js.map