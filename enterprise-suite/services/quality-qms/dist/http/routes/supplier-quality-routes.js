import { asObject, optionalNumber, optionalString, optionalUlid, requireBoolean, requireEnum, requireIsoDate, requireString, ulidParam, } from "../validation.js";
const STATUSES = [
    "open", "acknowledged", "in-remediation", "resolved", "written-off",
];
export function registerSupplierQualityRoutes(router, supplierQuality) {
    router.post("/supplier-quality/events", async ({ ctx, body }) => {
        const obj = asObject(body);
        const linkageRaw = obj["linkage"] ? asObject(obj["linkage"], "linkage") : undefined;
        const event = await supplierQuality.recordEvent(ctx, {
            supplierId: requireString(obj, "supplierId"),
            supplierName: optionalString(obj, "supplierName"),
            eventType: requireEnum(obj, "eventType", [
                "incoming-inspection-failure",
                "ncr-issued",
                "audit-finding",
                "certification-lapse",
                "delivery-quality",
                "field-failure",
            ]),
            severity: requireEnum(obj, "severity", ["critical", "major", "minor"]),
            description: requireString(obj, "description"),
            demeritPointsOverride: optionalNumber(obj, "demeritPointsOverride"),
            linkage: linkageRaw
                ? {
                    inspectionLotId: optionalUlid(linkageRaw, "inspectionLotId"),
                    ncrId: optionalUlid(linkageRaw, "ncrId"),
                    capaId: optionalUlid(linkageRaw, "capaId"),
                    auditId: optionalUlid(linkageRaw, "auditId"),
                    purchaseOrderRef: optionalString(linkageRaw, "purchaseOrderRef"),
                    materialCode: optionalString(linkageRaw, "materialCode"),
                }
                : undefined,
        });
        return { status: 201, body: event.toJSON() };
    });
    router.get("/supplier-quality/events", async ({ ctx, query }) => {
        const status = query.get("status");
        const items = await supplierQuality.listEvents(ctx, {
            status: status && STATUSES.includes(status)
                ? status
                : undefined,
            supplierId: query.get("supplierId") ?? undefined,
        });
        return { body: { items: items.map((e) => e.toJSON()), total: items.length } };
    });
    router.get("/supplier-quality/events/:id", async ({ ctx, params }) => {
        const event = await supplierQuality.getEvent(ctx, ulidParam(params, "id"));
        return { body: event.toJSON() };
    });
    router.post("/supplier-quality/events/:id/acknowledge", async ({ ctx, params }) => {
        return { body: (await supplierQuality.acknowledge(ctx, ulidParam(params, "id"))).toJSON() };
    });
    router.post("/supplier-quality/events/:id/scar", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const event = await supplierQuality.issueScar(ctx, ulidParam(params, "id"), {
            dueAt: requireIsoDate(obj, "dueAt"),
        });
        return { status: 201, body: event.toJSON() };
    });
    router.post("/supplier-quality/events/:id/scar/response", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        const event = await supplierQuality.recordScarResponse(ctx, ulidParam(params, "id"), {
            responseSummary: requireString(obj, "responseSummary"),
            accepted: requireBoolean(obj, "accepted"),
        });
        return { body: event.toJSON() };
    });
    router.post("/supplier-quality/events/:id/resolve", async ({ ctx, params, body }) => {
        const obj = body === undefined ? {} : asObject(body);
        return {
            body: (await supplierQuality.resolve(ctx, ulidParam(params, "id"), optionalString(obj, "note"))).toJSON(),
        };
    });
    router.post("/supplier-quality/events/:id/write-off", async ({ ctx, params, body }) => {
        const obj = asObject(body);
        return {
            body: (await supplierQuality.writeOff(ctx, ulidParam(params, "id"), requireString(obj, "reason"))).toJSON(),
        };
    });
    router.get("/supplier-quality/suppliers/:supplierId/summary", async ({ ctx, params }) => {
        const summary = await supplierQuality.supplierSummary(ctx, params["supplierId"]);
        return { body: summary };
    });
}
//# sourceMappingURL=supplier-quality-routes.js.map