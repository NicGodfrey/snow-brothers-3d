import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  ProofOfDelivery,
  type PodException,
  type PodMethod,
  type ReceiverRole,
} from "../domain/proof-of-delivery.js";
import type { Shipment } from "../domain/shipment.js";
import type { OutboxPort } from "../infrastructure/outbox.js";
import type {
  ProofOfDeliveryRepository,
  ShipmentRepository,
} from "../infrastructure/repositories.js";

export interface CapturePodCommand {
  readonly signedBy: string;
  readonly method: PodMethod;
  readonly receiverRole?: ReceiverRole;
  readonly capturedAt?: string;
  readonly documentUri?: string;
  readonly notes?: string;
  readonly exceptions?: readonly PodException[];
}

/** Statuses from which a driver can plausibly capture a POD. */
const CAPTURABLE_STATUSES = ["picked_up", "in_transit", "out_for_delivery", "exception"];

export class PodService {
  constructor(
    private readonly pods: ProofOfDeliveryRepository,
    private readonly shipments: ShipmentRepository,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Captures proof of delivery for a shipment. This is the delivery
   * confirmation flow: it records a DL tracking event (driving the
   * shipment to `delivered`), stores the POD, and links the two. One POD
   * per shipment.
   */
  async capture(
    ctx: TenantContext,
    shipmentId: Ulid,
    command: CapturePodCommand,
  ): Promise<{ pod: ProofOfDelivery; shipment: Shipment }> {
    const shipment = await this.shipments.findById(ctx.tenantId, shipmentId);
    if (shipment === undefined) {
      throw new NotFoundError("Shipment", shipmentId);
    }
    const existing = await this.pods.findByShipmentId(ctx.tenantId, shipmentId);
    if (existing !== undefined) {
      throw new ConflictError(`Shipment ${shipment.reference} already has a proof of delivery`);
    }
    if (!CAPTURABLE_STATUSES.includes(shipment.status)) {
      throw new ConflictError(
        `Cannot capture POD for a shipment in status '${shipment.status}' ` +
          `(expected one of: ${CAPTURABLE_STATUSES.join(", ")})`,
      );
    }

    const pod = ProofOfDelivery.capture(ctx.tenantId, {
      shipmentId,
      trackingNumber: shipment.trackingNumber,
      signedBy: command.signedBy,
      receiverRole: command.receiverRole,
      method: command.method,
      capturedAt: command.capturedAt,
      documentUri: command.documentUri,
      notes: command.notes,
      exceptions: command.exceptions,
    });

    shipment.recordTrackingEvent({
      code: "DL",
      description: `Delivered — signed by ${pod.signedBy}`,
      occurredAt: pod.capturedAt,
    });
    shipment.attachProofOfDelivery(pod.id);

    await this.pods.save(pod);
    await this.shipments.save(shipment);
    this.outbox.enqueue(pod.pullEvents());
    this.outbox.enqueue(shipment.pullEvents());
    return { pod, shipment };
  }

  /** Notes a discrepancy discovered after the POD was captured. */
  async noteException(
    ctx: TenantContext,
    podId: Ulid,
    exception: PodException,
  ): Promise<ProofOfDelivery> {
    const pod = await this.pods.findById(ctx.tenantId, podId);
    if (pod === undefined) {
      throw new NotFoundError("ProofOfDelivery", podId);
    }
    pod.noteException(exception);
    await this.pods.save(pod);
    this.outbox.enqueue(pod.pullEvents());
    return pod;
  }

  async getByShipment(ctx: TenantContext, shipmentId: Ulid): Promise<ProofOfDelivery> {
    const pod = await this.pods.findByShipmentId(ctx.tenantId, shipmentId);
    if (pod === undefined) {
      throw new NotFoundError("ProofOfDelivery", `shipment:${shipmentId}`);
    }
    return pod;
  }
}
