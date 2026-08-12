import { DomainError, newId, nowIso, } from "@enterprise-suite/shared-kernel";
import { isoDate } from "./calendar.js";
import { assertQty } from "./types.js";
export function makeInventoryRecord(tenantId, input) {
    const sku = input.sku?.trim().toUpperCase();
    if (!sku)
        throw new DomainError("Inventory SKU is required", "VALIDATION");
    return {
        tenantId,
        sku,
        location: input.location,
        onHandQty: assertQty("onHandQty", input.onHandQty),
        asOf: nowIso(),
    };
}
export function makeScheduledReceipt(tenantId, input) {
    const sku = input.sku?.trim().toUpperCase();
    if (!sku)
        throw new DomainError("Receipt SKU is required", "VALIDATION");
    const sourceRef = input.sourceRef?.trim();
    if (!sourceRef)
        throw new DomainError("sourceRef is required", "VALIDATION");
    if (!["PURCHASE_ORDER", "WORK_ORDER", "TRANSFER_ORDER"].includes(input.sourceType)) {
        throw new DomainError(`Invalid receipt sourceType: ${String(input.sourceType)}`, "VALIDATION");
    }
    return {
        id: newId("rcpt"),
        tenantId,
        sku,
        location: input.location,
        dueDate: isoDate(input.dueDate),
        qty: assertQty("qty", input.qty, { allowZero: false }),
        sourceType: input.sourceType,
        sourceRef,
        createdAt: nowIso(),
    };
}
//# sourceMappingURL=records.js.map