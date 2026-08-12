import type { AmendableTerms, ContractType, PayFrequency } from "../../domain/employment-contract.js";
import type { HcmModule } from "../../module.js";
import {
  actorId,
  asRecord,
  dateField,
  enumField,
  moneyField,
  optDateField,
  optEnumField,
  optMoneyField,
  optNum,
  optStr,
  requireRole,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

const CONTRACT_TYPES: readonly ContractType[] = ["permanent", "fixed_term", "contractor", "intern"];
const PAY_FREQUENCIES: readonly PayFrequency[] = ["monthly", "biweekly", "weekly"];

export function registerContractRoutes(router: Router, module: HcmModule): void {
  const { contractService } = module;

  router.post("/contracts", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const contract = contractService.draftContract(req.ctx.tenantId, {
      employeeId: ulidField(body, "employeeId"),
      positionId: ulidField(body, "positionId"),
      contractType: enumField(body, "contractType", CONTRACT_TYPES),
      startDate: dateField(body, "startDate"),
      endDate: optDateField(body, "endDate"),
      probationEndDate: optDateField(body, "probationEndDate"),
      fte: optNum(body, "fte"),
      weeklyHours: optNum(body, "weeklyHours"),
      baseSalary: moneyField(body, "baseSalary"),
      payFrequency: optEnumField(body, "payFrequency", PAY_FREQUENCIES),
    });
    return created(contract.toJSON());
  });

  router.get("/contracts/:id", (req) =>
    jsonOk(contractService.getContract(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.get("/employees/:id/contracts", (req) =>
    jsonOk({
      items: contractService
        .listByEmployee(req.ctx.tenantId, ulidParam(req.params, "id"))
        .map((c) => c.toJSON()),
    }),
  );

  router.post("/contracts/:id/activate", (req) => {
    requireRole(req.ctx, "hr_admin");
    return jsonOk(
      contractService
        .activateContract(req.ctx.tenantId, ulidParam(req.params, "id"), actorId(req.ctx))
        .toJSON(),
    );
  });

  router.post("/contracts/:id/amend", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const changesBody = asRecord(body.changes ?? {});
    const changes: Partial<AmendableTerms> = {};
    const fte = optNum(changesBody, "fte");
    if (fte !== undefined) changes.fte = fte;
    const weeklyHours = optNum(changesBody, "weeklyHours");
    if (weeklyHours !== undefined) changes.weeklyHours = weeklyHours;
    const endDate = optDateField(changesBody, "endDate");
    if (endDate !== undefined) changes.endDate = endDate;
    const baseSalary = optMoneyField(changesBody, "baseSalary");
    if (baseSalary !== undefined) changes.baseSalary = baseSalary;
    return jsonOk(
      contractService
        .amendContract(req.ctx.tenantId, ulidParam(req.params, "id"), {
          effectiveDate: dateField(body, "effectiveDate"),
          amendedBy: actorId(req.ctx),
          changes,
          note: optStr(body, "note"),
        })
        .toJSON(),
    );
  });

  router.post("/contracts/:id/terminate", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    return jsonOk(
      contractService
        .terminateContract(req.ctx.tenantId, ulidParam(req.params, "id"), {
          terminationDate: dateField(body, "terminationDate"),
          note: optStr(body, "note"),
        })
        .toJSON(),
    );
  });

  router.post("/contracts/expire-sweep", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body ?? {});
    const expired = contractService.expireContracts(req.ctx.tenantId, optDateField(body, "asOf"));
    return jsonOk({ expiredCount: expired.length, items: expired.map((c) => c.toJSON()) });
  });
}
