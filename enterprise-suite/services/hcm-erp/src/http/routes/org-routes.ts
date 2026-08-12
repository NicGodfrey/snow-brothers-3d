import { normalizePage, paginate } from "@enterprise-suite/shared-kernel";
import type { OrgUnitKind } from "../../domain/org-unit.js";
import { GRADES, type Grade } from "../../domain/position.js";
import type { HcmModule } from "../../module.js";
import {
  asRecord,
  enumField,
  optNum,
  optStr,
  optUlid,
  requireRole,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

const ORG_KINDS: readonly OrgUnitKind[] = ["company", "division", "department", "team"];

export function registerOrgRoutes(router: Router, module: HcmModule): void {
  const { orgService } = module;

  router.post("/org-units", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const unit = orgService.createOrgUnit(req.ctx.tenantId, {
      code: str(body, "code"),
      name: str(body, "name"),
      kind: enumField(body, "kind", ORG_KINDS),
      parentId: optStr(body, "parentId"),
      costCenter: optStr(body, "costCenter"),
    });
    return created(unit.toJSON());
  });

  router.get("/org-units", (req) => {
    const page = normalizePage({
      page: Number(req.query.get("page") ?? 1),
      pageSize: Number(req.query.get("pageSize") ?? 20),
    });
    const units = orgService.listOrgUnits(req.ctx.tenantId).map((u) => u.toJSON());
    return jsonOk(paginate(units, page));
  });

  router.get("/org-units/:id", (req) =>
    jsonOk(orgService.getOrgUnit(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.get("/org-units/:id/subtree", (req) =>
    jsonOk({
      items: orgService.subtree(req.ctx.tenantId, ulidParam(req.params, "id")).map((u) => u.toJSON()),
    }),
  );

  router.patch("/org-units/:id", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const id = ulidParam(req.params, "id");
    const name = optStr(body, "name");
    let unit = orgService.getOrgUnit(req.ctx.tenantId, id);
    if (name !== undefined) unit = orgService.renameOrgUnit(req.ctx.tenantId, id, name);
    if ("costCenter" in body) {
      unit.setCostCenter(optStr(body, "costCenter"));
      module.repos.orgUnits.save(unit);
    }
    return jsonOk(unit.toJSON());
  });

  router.post("/org-units/:id/move", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const unit = orgService.moveOrgUnit(
      req.ctx.tenantId,
      ulidParam(req.params, "id"),
      ulidField(body, "newParentId"),
    );
    return jsonOk(unit.toJSON());
  });

  router.post("/org-units/:id/deactivate", (req) => {
    requireRole(req.ctx, "hr_admin");
    return jsonOk(orgService.deactivateOrgUnit(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
  });

  // ---------------------------------------------------------------- positions

  router.post("/positions", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const position = orgService.openPosition(req.ctx.tenantId, {
      orgUnitId: ulidField(body, "orgUnitId"),
      title: str(body, "title"),
      jobFamily: optStr(body, "jobFamily"),
      grade: enumField(body, "grade", GRADES as readonly Grade[]),
      fte: optNum(body, "fte"),
      reportsToPositionId: optUlid(body, "reportsToPositionId"),
    });
    return created(position.toJSON());
  });

  router.get("/positions", (req) => {
    const orgUnitId = req.query.get("orgUnitId");
    const positions = orgService.listPositions(
      req.ctx.tenantId,
      orgUnitId ? (orgUnitId as never) : undefined,
    );
    const page = normalizePage({
      page: Number(req.query.get("page") ?? 1),
      pageSize: Number(req.query.get("pageSize") ?? 20),
    });
    return jsonOk(paginate(positions.map((p) => p.toJSON()), page));
  });

  router.get("/positions/:id", (req) =>
    jsonOk(orgService.getPosition(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.post("/positions/:id/freeze", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    return jsonOk(
      orgService.freezePosition(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "reason")).toJSON(),
    );
  });

  router.post("/positions/:id/unfreeze", (req) => {
    requireRole(req.ctx, "hr_admin");
    return jsonOk(orgService.unfreezePosition(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
  });

  router.post("/positions/:id/eliminate", (req) => {
    requireRole(req.ctx, "hr_admin");
    return jsonOk(orgService.eliminatePosition(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
  });

  router.post("/positions/:id/reports-to", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    return jsonOk(
      orgService
        .changePositionReportsTo(req.ctx.tenantId, ulidParam(req.params, "id"), optUlid(body, "reportsToPositionId"))
        .toJSON(),
    );
  });
}
