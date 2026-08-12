import { DomainError } from "@enterprise-suite/shared-kernel";
import type { PodService } from "../../application/pod-service.js";
import type { ShipmentService } from "../../application/shipment-service.js";
import type { PodException, PodMethod, ReceiverRole } from "../../domain/proof-of-delivery.js";
import {
  TRACKING_CODES,
  type ShipmentStatus,
  type TrackingCode,
} from "../../domain/shipment.js";
import { parseAddress, parsePackage } from "../parsers.js";
import type { Router } from "../router.js";
import {
  expectObject,
  idParam,
  optArray,
  optString,
  optStringArray,
  pageParams,
  reqId,
  reqString,
} from "../validate.js";

export function registerShipmentRoutes(
  router: Router,
  shipments: ShipmentService,
  pods: PodService,
): void {
  router.post("/shipments", async (rc) => {
    const body = expectObject(rc.body);
    const packagesRaw = optArray(body, "packages") ?? [];
    const shipment = await shipments.createShipment(rc.tenant, {
      reference: optString(body, "reference"),
      orderRef: optString(body, "orderRef"),
      origin: parseAddress(body.origin, "origin"),
      destination: parseAddress(body.destination, "destination"),
      packages: packagesRaw.map((p, i) => parsePackage(p, `packages[${i}]`)),
      accessorialCodes: optStringArray(body, "accessorialCodes"),
    });
    return { status: 201, body: shipment };
  });

  router.get("/shipments", async (rc) => {
    const status = rc.query.get("status") ?? undefined;
    const page = await shipments.listShipments(
      rc.tenant,
      {
        status: status as ShipmentStatus | undefined,
        orderRef: rc.query.get("orderRef") ?? undefined,
      },
      pageParams(rc.query),
    );
    return { status: 200, body: page };
  });

  router.get("/shipments/:shipmentId", async (rc) => {
    const shipment = await shipments.getShipment(rc.tenant, idParam(rc.params, "shipmentId"));
    return { status: 200, body: shipment };
  });

  router.get("/tracking/:trackingNumber", async (rc) => {
    const shipment = await shipments.getByTrackingNumber(
      rc.tenant,
      rc.params.trackingNumber ?? "",
    );
    return {
      status: 200,
      body: {
        trackingNumber: shipment.trackingNumber,
        reference: shipment.reference,
        status: shipment.status,
        events: shipment.trackingEvents,
      },
    };
  });

  router.post("/shipments/:shipmentId/packages", async (rc) => {
    const shipment = await shipments.addPackage(
      rc.tenant,
      idParam(rc.params, "shipmentId"),
      parsePackage(rc.body, "package"),
    );
    return { status: 200, body: shipment };
  });

  router.delete("/shipments/:shipmentId/packages/:packageId", async (rc) => {
    const shipment = await shipments.removePackage(
      rc.tenant,
      idParam(rc.params, "shipmentId"),
      idParam(rc.params, "packageId"),
    );
    return { status: 200, body: shipment };
  });

  router.post("/shipments/:shipmentId/book", async (rc) => {
    const body = expectObject(rc.body);
    const shipment = await shipments.bookShipment(rc.tenant, idParam(rc.params, "shipmentId"), {
      carrierId: reqId(body, "carrierId"),
      serviceLevelCode: reqString(body, "serviceLevelCode"),
      trackingNumber: optString(body, "trackingNumber"),
      shipDate: optString(body, "shipDate"),
    });
    return { status: 200, body: shipment };
  });

  router.post("/shipments/:shipmentId/tracking-events", async (rc) => {
    const body = expectObject(rc.body);
    const code = reqString(body, "code").toUpperCase();
    if (!(TRACKING_CODES as readonly string[]).includes(code)) {
      throw new DomainError(
        `code must be one of ${TRACKING_CODES.join(", ")}`,
        "VALIDATION",
      );
    }
    const { shipment, event } = await shipments.recordTrackingEvent(
      rc.tenant,
      idParam(rc.params, "shipmentId"),
      {
        code: code as TrackingCode,
        description: optString(body, "description"),
        location: optString(body, "location"),
        occurredAt: optString(body, "occurredAt"),
      },
    );
    return { status: 201, body: { event, status: shipment.status } };
  });

  router.get("/shipments/:shipmentId/tracking-events", async (rc) => {
    const shipment = await shipments.getShipment(rc.tenant, idParam(rc.params, "shipmentId"));
    return { status: 200, body: { items: shipment.trackingEvents, status: shipment.status } };
  });

  router.post("/shipments/:shipmentId/cancel", async (rc) => {
    const body = expectObject(rc.body);
    const shipment = await shipments.cancelShipment(
      rc.tenant,
      idParam(rc.params, "shipmentId"),
      reqString(body, "reason"),
    );
    return { status: 200, body: shipment };
  });

  // -- proof of delivery -------------------------------------------------------

  router.post("/shipments/:shipmentId/pod", async (rc) => {
    const body = expectObject(rc.body);
    const exceptionsRaw = optArray(body, "exceptions") ?? [];
    const exceptions = exceptionsRaw.map((raw, i): PodException => {
      const obj = expectObject(raw, `exceptions[${i}]`);
      return {
        code: reqString(obj, "code") as PodException["code"],
        description: reqString(obj, "description"),
        packageRef: optString(obj, "packageRef"),
      };
    });
    const { pod, shipment } = await pods.capture(rc.tenant, idParam(rc.params, "shipmentId"), {
      signedBy: reqString(body, "signedBy"),
      method: reqString(body, "method") as PodMethod,
      receiverRole: optString(body, "receiverRole") as ReceiverRole | undefined,
      capturedAt: optString(body, "capturedAt"),
      documentUri: optString(body, "documentUri"),
      notes: optString(body, "notes"),
      exceptions,
    });
    return { status: 201, body: { pod, shipmentStatus: shipment.status } };
  });

  router.get("/shipments/:shipmentId/pod", async (rc) => {
    const pod = await pods.getByShipment(rc.tenant, idParam(rc.params, "shipmentId"));
    return { status: 200, body: pod };
  });

  router.post("/pods/:podId/exceptions", async (rc) => {
    const body = expectObject(rc.body);
    const pod = await pods.noteException(rc.tenant, idParam(rc.params, "podId"), {
      code: reqString(body, "code") as PodException["code"],
      description: reqString(body, "description"),
      packageRef: optString(body, "packageRef"),
    });
    return { status: 201, body: pod };
  });
}
