import { asObject, optionalString, requireLocation, requireNumber } from "../validate.js";
export function registerPlanningRunRoutes(router, module) {
    router.post("/planning-runs", async (req) => {
        const body = asObject(req.body);
        const run = await module.planning.createRun(req.ctx, {
            name: optionalString(body, "name"),
            location: requireLocation(body),
            horizonWeeks: requireNumber(body, "horizonWeeks"),
            scope: body.scope,
        });
        return { status: 201, body: run.toJSON() };
    });
    router.get("/planning-runs", async (req) => {
        const runs = await module.planning.listRuns(req.ctx);
        return {
            status: 200,
            body: {
                runs: runs.map((run) => {
                    const { audit, ...rest } = run.toJSON();
                    return { ...rest, auditEntryCount: Array.isArray(audit) ? audit.length : 0 };
                }),
            },
        };
    });
    router.get("/planning-runs/:id", async (req) => {
        const run = await module.planning.getRun(req.ctx, req.params.id);
        return { status: 200, body: run.toJSON() };
    });
    router.post("/planning-runs/:id/execute", async (req) => {
        const run = await module.planning.executeRun(req.ctx, req.params.id);
        return { status: 200, body: run.toJSON() };
    });
    router.get("/planning-runs/:id/audit", async (req) => {
        const run = await module.planning.getRun(req.ctx, req.params.id);
        return { status: 200, body: { runId: run.id, status: run.status, audit: run.audit } };
    });
}
//# sourceMappingURL=planning-runs.js.map