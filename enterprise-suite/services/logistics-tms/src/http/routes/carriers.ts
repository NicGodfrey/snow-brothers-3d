import { DomainError } from "@enterprise-suite/shared-kernel";
import type { CarrierService } from "../../application/carrier-service.js";
import { isTransportMode, type TransportMode } from "../../domain/values.js";
import type { Router } from "../router.js";
import {
  expectObject,
  idParam,
  optBoolean,
  optString,
  pageParams,
  reqNumber,
  reqString,
} from "../validate.js";

export function registerCarrierRoutes(router: Router, carriers: CarrierService): void {
  router.post("/carriers", async (rc) => {
    const body = expectObject(rc.body);
    const mode = reqString(body, "mode");
    if (!isTransportMode(mode)) {
      throw new DomainError("mode must be one of parcel|ltl|ftl", "VALIDATION");
    }
    const carrier = await carriers.createCarrier(rc.tenant, {
      code: reqString(body, "code"),
      name: reqString(body, "name"),
      mode,
      scac: optString(body, "scac"),
    });
    return { status: 201, body: carrier };
  });

  router.get("/carriers", async (rc) => {
    const modeRaw = rc.query.get("mode") ?? undefined;
    const mode =
      modeRaw !== undefined && isTransportMode(modeRaw) ? (modeRaw as TransportMode) : undefined;
    const page = await carriers.listCarriers(
      rc.tenant,
      { status: rc.query.get("status") ?? undefined, mode },
      pageParams(rc.query),
    );
    return { status: 200, body: page };
  });

  router.get("/carriers/:carrierId", async (rc) => {
    const carrier = await carriers.getCarrier(rc.tenant, idParam(rc.params, "carrierId"));
    return { status: 200, body: carrier };
  });

  router.patch("/carriers/:carrierId", async (rc) => {
    const body = expectObject(rc.body);
    const carrier = await carriers.updateCarrier(rc.tenant, idParam(rc.params, "carrierId"), {
      name: optString(body, "name"),
      scac: optString(body, "scac"),
    });
    return { status: 200, body: carrier };
  });

  router.post("/carriers/:carrierId/activate", async (rc) => {
    const carrier = await carriers.activateCarrier(rc.tenant, idParam(rc.params, "carrierId"));
    return { status: 200, body: carrier };
  });

  router.post("/carriers/:carrierId/deactivate", async (rc) => {
    const carrier = await carriers.deactivateCarrier(rc.tenant, idParam(rc.params, "carrierId"));
    return { status: 200, body: carrier };
  });

  router.post("/carriers/:carrierId/service-levels", async (rc) => {
    const body = expectObject(rc.body);
    const carrier = await carriers.upsertServiceLevel(rc.tenant, idParam(rc.params, "carrierId"), {
      code: reqString(body, "code"),
      name: reqString(body, "name"),
      transitDays: reqNumber(body, "transitDays"),
      cutoffHour: reqNumber(body, "cutoffHour"),
      signatureRequired: optBoolean(body, "signatureRequired") ?? false,
    });
    return { status: 200, body: carrier };
  });

  router.delete("/carriers/:carrierId/service-levels/:code", async (rc) => {
    const carrier = await carriers.removeServiceLevel(
      rc.tenant,
      idParam(rc.params, "carrierId"),
      rc.params.code ?? "",
    );
    return { status: 200, body: carrier };
  });
}
