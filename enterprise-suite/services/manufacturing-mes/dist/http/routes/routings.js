import { DomainError } from "@enterprise-suite/shared-kernel";
import { ROUTING_STATUSES } from "../../domain/routing.js";
import { asRecord, optionalArray, optionalBoolean, optionalNumber, optionalString, requireNumber, requireString, } from "../validate.js";
function parseOperation(raw, label) {
    const op = asRecord(raw, label);
    return {
        seq: requireNumber(op, "seq"),
        description: requireString(op, "description"),
        workCenterId: requireString(op, "workCenterId"),
        setupMinutes: optionalNumber(op, "setupMinutes"),
        runMinutesPerUnit: requireNumber(op, "runMinutesPerUnit"),
        teardownMinutes: optionalNumber(op, "teardownMinutes"),
        queueMinutes: optionalNumber(op, "queueMinutes"),
        moveMinutes: optionalNumber(op, "moveMinutes"),
        inspectionRequired: optionalBoolean(op, "inspectionRequired"),
        crewSize: optionalNumber(op, "crewSize"),
    };
}
export function registerRoutingRoutes(router, container) {
    const service = container.services.routings;
    router.post("/routings", async (req) => {
        const body = asRecord(req.body);
        const routing = await service.create(req.ctx, {
            sku: requireString(body, "sku"),
            revision: optionalString(body, "revision"),
            description: optionalString(body, "description"),
            operations: optionalArray(body, "operations")?.map((op, i) => parseOperation(op, `operations[${i}]`)),
        });
        return { status: 201, body: routing.toJSON() };
    });
    router.get("/routings", async (req) => {
        const status = req.query.get("status") ?? undefined;
        if (status && !ROUTING_STATUSES.includes(status)) {
            throw new DomainError(`status must be one of [${ROUTING_STATUSES.join(", ")}]`, "VALIDATION", 400);
        }
        const routings = await service.list(req.ctx, {
            sku: req.query.get("sku") ?? undefined,
            status: status,
        });
        return routings.map((r) => r.toJSON());
    });
    router.get("/routings/:id", async (req) => {
        return (await service.get(req.ctx, req.params.id)).toJSON();
    });
    router.post("/routings/:id/operations", async (req) => {
        const routing = await service.addOperation(req.ctx, req.params.id, parseOperation(req.body, "operation"));
        return { status: 201, body: routing.toJSON() };
    });
    router.patch("/routings/:id/operations/:seq", async (req) => {
        const body = asRecord(req.body);
        const routing = await service.updateOperation(req.ctx, req.params.id, seqParam(req.params.seq), {
            description: optionalString(body, "description"),
            workCenterId: optionalString(body, "workCenterId"),
            setupMinutes: optionalNumber(body, "setupMinutes"),
            runMinutesPerUnit: optionalNumber(body, "runMinutesPerUnit"),
            teardownMinutes: optionalNumber(body, "teardownMinutes"),
            queueMinutes: optionalNumber(body, "queueMinutes"),
            moveMinutes: optionalNumber(body, "moveMinutes"),
            inspectionRequired: optionalBoolean(body, "inspectionRequired"),
            crewSize: optionalNumber(body, "crewSize"),
        });
        return routing.toJSON();
    });
    router.delete("/routings/:id/operations/:seq", async (req) => {
        const routing = await service.removeOperation(req.ctx, req.params.id, seqParam(req.params.seq));
        return routing.toJSON();
    });
    router.post("/routings/:id/release", async (req) => {
        return (await service.release(req.ctx, req.params.id)).toJSON();
    });
    router.post("/routings/:id/obsolete", async (req) => {
        return (await service.makeObsolete(req.ctx, req.params.id)).toJSON();
    });
    router.get("/routings/:id/lead-time", async (req) => {
        const quantityRaw = req.query.get("quantity");
        const quantity = Number(quantityRaw);
        if (!quantityRaw || !Number.isFinite(quantity) || quantity <= 0) {
            throw new DomainError("Query param 'quantity' must be a positive number", "VALIDATION", 400);
        }
        return service.estimateLeadTime(req.ctx, req.params.id, quantity);
    });
}
function seqParam(raw) {
    const seq = Number(raw);
    if (!Number.isInteger(seq) || seq < 1) {
        throw new DomainError("Path param 'seq' must be a positive integer", "VALIDATION", 400);
    }
    return seq;
}
//# sourceMappingURL=routings.js.map