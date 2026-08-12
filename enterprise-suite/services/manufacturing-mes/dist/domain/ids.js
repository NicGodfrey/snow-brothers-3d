import { brand, newId } from "@enterprise-suite/shared-kernel";
export const workCenterId = (v) => brand(v ?? newId("wc"));
export const shiftTemplateId = (v) => brand(v ?? newId("shift"));
export const capacityCalendarId = (v) => brand(v ?? newId("cal"));
export const routingId = (v) => brand(v ?? newId("rtg"));
export const workOrderId = (v) => brand(v ?? newId("wo"));
export const materialIssueId = (v) => brand(v ?? newId("mi"));
export const productionReceiptId = (v) => brand(v ?? newId("pr"));
export const scrapRecordId = (v) => brand(v ?? newId("scrap"));
/** Convert a branded domain id to the kernel Ulid used in event envelopes. */
export const asUlid = (id) => brand(id);
/** Units of measure the MES understands. Kept as a closed list so math stays safe. */
export const UNITS_OF_MEASURE = ["EA", "KG", "G", "L", "ML", "M", "CM", "M2", "HR"];
export function isUnitOfMeasure(value) {
    return UNITS_OF_MEASURE.includes(value);
}
export function qty(value, uom) {
    if (!Number.isFinite(value))
        throw new Error("Quantity must be finite");
    // Round to 6 decimals to avoid FP drift accumulating through issue/receipt math.
    return { value: Math.round(value * 1e6) / 1e6, uom };
}
export function addQty(a, b) {
    assertSameUom(a, b);
    return qty(a.value + b.value, a.uom);
}
export function subQty(a, b) {
    assertSameUom(a, b);
    return qty(a.value - b.value, a.uom);
}
export function scaleQty(a, factor) {
    return qty(a.value * factor, a.uom);
}
function assertSameUom(a, b) {
    if (a.uom !== b.uom) {
        throw new Error(`Unit of measure mismatch: ${a.uom} vs ${b.uom}`);
    }
}
//# sourceMappingURL=ids.js.map