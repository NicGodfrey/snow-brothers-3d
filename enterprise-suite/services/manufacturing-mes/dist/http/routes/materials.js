import { asRecord, optionalBoolean, optionalString, requireArray, requireNumber, requireString, } from "../validate.js";
function parseLines(body) {
    return requireArray(body, "lines").map((raw, i) => {
        const line = asRecord(raw, `lines[${i}]`);
        return {
            componentSku: requireString(line, "componentSku"),
            qty: requireNumber(line, "qty"),
            uom: requireString(line, "uom"),
            lotNumber: optionalString(line, "lotNumber"),
            binCode: optionalString(line, "binCode"),
            unplanned: optionalBoolean(line, "unplanned"),
        };
    });
}
export function registerMaterialRoutes(router, container) {
    const service = container.services.materials;
    router.post("/work-orders/:id/material-issues", async (req) => {
        const body = asRecord(req.body);
        const { document, workOrder } = await service.issueMaterials(req.ctx, req.params.id, {
            warehouseCode: requireString(body, "warehouseCode"),
            lines: parseLines(body),
            note: optionalString(body, "note"),
        });
        return {
            status: 201,
            body: { document: document.toJSON(), workOrder: workOrder.toJSON() },
        };
    });
    router.post("/work-orders/:id/material-returns", async (req) => {
        const body = asRecord(req.body);
        const { document, workOrder } = await service.returnMaterials(req.ctx, req.params.id, {
            warehouseCode: requireString(body, "warehouseCode"),
            lines: parseLines(body),
            note: optionalString(body, "note"),
        });
        return {
            status: 201,
            body: { document: document.toJSON(), workOrder: workOrder.toJSON() },
        };
    });
    router.get("/work-orders/:id/material-issues", async (req) => {
        const documents = await service.listIssuesForWorkOrder(req.ctx, req.params.id);
        return documents.map((doc) => doc.toJSON());
    });
    router.post("/work-orders/:id/receipts", async (req) => {
        const body = asRecord(req.body);
        const { document, workOrder } = await service.postReceipt(req.ctx, req.params.id, {
            qtyGood: requireNumber(body, "qtyGood"),
            warehouseCode: requireString(body, "warehouseCode"),
            lotNumber: optionalString(body, "lotNumber"),
            note: optionalString(body, "note"),
        });
        return {
            status: 201,
            body: { document: document.toJSON(), workOrder: workOrder.toJSON() },
        };
    });
    router.get("/work-orders/:id/receipts", async (req) => {
        const documents = await service.listReceiptsForWorkOrder(req.ctx, req.params.id);
        return documents.map((doc) => doc.toJSON());
    });
}
//# sourceMappingURL=materials.js.map