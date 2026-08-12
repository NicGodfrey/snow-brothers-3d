import { DomainError } from "@enterprise-suite/shared-kernel";
import type { LoadService } from "../../application/load-service.js";
import type { LoadMode, LoadStatus, StopType } from "../../domain/load.js";
import { parseAddress } from "../parsers.js";
import type { Router } from "../router.js";
import {
  expectObject,
  idParam,
  optId,
  optNumber,
  optString,
  pageParams,
  reqId,
  reqNumber,
  reqString,
} from "../validate.js";

export function registerLoadRoutes(router: Router, loads: LoadService): void {
  router.post("/loads", async (rc) => {
    const body = expectObject(rc.body);
    const mode = reqString(body, "mode");
    if (mode !== "ltl" && mode !== "ftl") {
      throw new DomainError("mode must be ltl or ftl", "VALIDATION");
    }
    const load = await loads.createLoad(rc.tenant, {
      reference: optString(body, "reference"),
      mode: mode as LoadMode,
      carrierId: optId(body, "carrierId"),
      driverName: optString(body, "driverName"),
      vehicleRef: optString(body, "vehicleRef"),
      plannedDistanceKm: optNumber(body, "plannedDistanceKm"),
    });
    return { status: 201, body: load };
  });

  router.get("/loads", async (rc) => {
    const status = rc.query.get("status") ?? undefined;
    const page = await loads.listLoads(
      rc.tenant,
      { status: status as LoadStatus | undefined },
      pageParams(rc.query),
    );
    return { status: 200, body: page };
  });

  router.get("/loads/:loadId", async (rc) => {
    const load = await loads.getLoad(rc.tenant, idParam(rc.params, "loadId"));
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/carrier", async (rc) => {
    const body = expectObject(rc.body);
    const load = await loads.assignCarrier(
      rc.tenant,
      idParam(rc.params, "loadId"),
      reqId(body, "carrierId"),
    );
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/driver", async (rc) => {
    const body = expectObject(rc.body);
    const load = await loads.assignDriver(rc.tenant, idParam(rc.params, "loadId"), {
      driverName: optString(body, "driverName"),
      vehicleRef: optString(body, "vehicleRef"),
    });
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/stops", async (rc) => {
    const body = expectObject(rc.body);
    const type = reqString(body, "type");
    if (type !== "pickup" && type !== "delivery") {
      throw new DomainError("type must be pickup or delivery", "VALIDATION");
    }
    const load = await loads.addStop(rc.tenant, idParam(rc.params, "loadId"), {
      sequence: reqNumber(body, "sequence"),
      type: type as StopType,
      facilityName: reqString(body, "facilityName"),
      address: parseAddress(body.address, "address"),
      windowStart: optString(body, "windowStart"),
      windowEnd: optString(body, "windowEnd"),
    });
    return { status: 200, body: load };
  });

  router.delete("/loads/:loadId/stops/:stopId", async (rc) => {
    const load = await loads.removeStop(
      rc.tenant,
      idParam(rc.params, "loadId"),
      idParam(rc.params, "stopId"),
    );
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/assignments", async (rc) => {
    const body = expectObject(rc.body);
    const load = await loads.assignShipment(rc.tenant, idParam(rc.params, "loadId"), {
      shipmentId: reqId(body, "shipmentId"),
      pickupStopId: reqId(body, "pickupStopId"),
      deliveryStopId: reqId(body, "deliveryStopId"),
    });
    return { status: 200, body: load };
  });

  router.delete("/loads/:loadId/assignments/:shipmentId", async (rc) => {
    const load = await loads.unassignShipment(
      rc.tenant,
      idParam(rc.params, "loadId"),
      idParam(rc.params, "shipmentId"),
    );
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/dispatch", async (rc) => {
    const load = await loads.dispatch(rc.tenant, idParam(rc.params, "loadId"));
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/stops/:stopId/arrive", async (rc) => {
    const body = rc.body === undefined ? {} : expectObject(rc.body);
    const load = await loads.recordStopArrival(
      rc.tenant,
      idParam(rc.params, "loadId"),
      idParam(rc.params, "stopId"),
      optString(body, "at"),
    );
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/stops/:stopId/depart", async (rc) => {
    const body = rc.body === undefined ? {} : expectObject(rc.body);
    const load = await loads.recordStopDeparture(
      rc.tenant,
      idParam(rc.params, "loadId"),
      idParam(rc.params, "stopId"),
      optString(body, "at"),
    );
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/complete", async (rc) => {
    const load = await loads.complete(rc.tenant, idParam(rc.params, "loadId"));
    return { status: 200, body: load };
  });

  router.post("/loads/:loadId/cancel", async (rc) => {
    const body = expectObject(rc.body);
    const load = await loads.cancel(
      rc.tenant,
      idParam(rc.params, "loadId"),
      reqString(body, "reason"),
    );
    return { status: 200, body: load };
  });
}
