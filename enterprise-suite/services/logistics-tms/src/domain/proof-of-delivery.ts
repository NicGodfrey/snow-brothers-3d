import {
  AggregateRoot,
  DomainError,
  envelope,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { LogisticsEvents, type PodCapturedPayload } from "./events.js";
import { assertIsoDateTime } from "./values.js";

export type PodMethod = "signature" | "photo" | "pin";

export type PodExceptionCode = "damaged" | "shortage" | "refused" | "wet" | "other";

/** A discrepancy noted at delivery time (feeds OS&D / claims workflows). */
export interface PodException {
  readonly code: PodExceptionCode;
  readonly description: string;
  /** Reference of the affected package, when identifiable. */
  readonly packageRef?: string;
}

export type ReceiverRole = "consignee" | "neighbor" | "front_desk" | "driver_release";

export interface ProofOfDeliveryProps {
  shipmentId: Ulid;
  trackingNumber?: string;
  signedBy: string;
  receiverRole: ReceiverRole;
  method: PodMethod;
  capturedAt: IsoDateTime;
  /** URI of the stored signature image / photo / e-sign record. */
  documentUri?: string;
  notes?: string;
  exceptions: PodException[];
}

export interface CapturePodInput {
  readonly shipmentId: Ulid;
  readonly trackingNumber?: string;
  readonly signedBy: string;
  readonly receiverRole?: ReceiverRole;
  readonly method: PodMethod;
  readonly capturedAt?: string;
  readonly documentUri?: string;
  readonly notes?: string;
  readonly exceptions?: readonly PodException[];
}

const POD_METHODS: readonly PodMethod[] = ["signature", "photo", "pin"];
const EXCEPTION_CODES: readonly PodExceptionCode[] = [
  "damaged",
  "shortage",
  "refused",
  "wet",
  "other",
];
const RECEIVER_ROLES: readonly ReceiverRole[] = [
  "consignee",
  "neighbor",
  "front_desk",
  "driver_release",
];

/** Tolerated clock skew when validating capturedAt is not in the future. */
const FUTURE_SKEW_MS = 5 * 60_000;

function validateException(input: PodException): PodException {
  if (!EXCEPTION_CODES.includes(input.code)) {
    throw new DomainError(
      `exception.code must be one of ${EXCEPTION_CODES.join(", ")}`,
      "VALIDATION",
    );
  }
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    throw new DomainError("exception.description is required", "VALIDATION");
  }
  return {
    code: input.code,
    description: input.description.trim(),
    packageRef: input.packageRef?.trim() || undefined,
  };
}

export class ProofOfDelivery extends AggregateRoot<ProofOfDeliveryProps> {
  private constructor(tenantId: TenantId, props: ProofOfDeliveryProps) {
    super(tenantId, props);
  }

  static capture(tenantId: TenantId, input: CapturePodInput): ProofOfDelivery {
    if (typeof input.signedBy !== "string" || input.signedBy.trim().length === 0) {
      throw new DomainError("pod.signedBy is required", "VALIDATION");
    }
    if (!POD_METHODS.includes(input.method)) {
      throw new DomainError(
        `pod.method must be one of ${POD_METHODS.join(", ")}`,
        "VALIDATION",
      );
    }
    const receiverRole = input.receiverRole ?? "consignee";
    if (!RECEIVER_ROLES.includes(receiverRole)) {
      throw new DomainError(
        `pod.receiverRole must be one of ${RECEIVER_ROLES.join(", ")}`,
        "VALIDATION",
      );
    }
    const capturedAt = (
      input.capturedAt !== undefined
        ? assertIsoDateTime(input.capturedAt, "pod.capturedAt")
        : new Date().toISOString()
    ) as IsoDateTime;
    if (Date.parse(capturedAt) > Date.now() + FUTURE_SKEW_MS) {
      throw new DomainError("pod.capturedAt cannot be in the future", "VALIDATION");
    }
    const exceptions = (input.exceptions ?? []).map(validateException);
    const pod = new ProofOfDelivery(tenantId, {
      shipmentId: input.shipmentId,
      trackingNumber: input.trackingNumber,
      signedBy: input.signedBy.trim(),
      receiverRole,
      method: input.method,
      capturedAt,
      documentUri: input.documentUri?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      exceptions,
    });
    pod.raise(
      envelope<PodCapturedPayload>({
        eventType: LogisticsEvents.PodCaptured,
        aggregateType: "ProofOfDelivery",
        aggregateId: pod.id,
        tenantId,
        payload: {
          podId: pod.id,
          shipmentId: input.shipmentId,
          signedBy: pod.props.signedBy,
          method: input.method,
          capturedAt,
          exceptionCount: exceptions.length,
        },
      }),
    );
    return pod;
  }

  get shipmentId(): Ulid {
    return this.props.shipmentId;
  }

  get signedBy(): string {
    return this.props.signedBy;
  }

  get method(): PodMethod {
    return this.props.method;
  }

  get capturedAt(): IsoDateTime {
    return this.props.capturedAt;
  }

  get exceptions(): readonly PodException[] {
    return this.props.exceptions;
  }

  hasExceptions(): boolean {
    return this.props.exceptions.length > 0;
  }

  /** Notes an additional discrepancy discovered after capture (e.g. concealed damage). */
  noteException(input: PodException): PodException {
    const exception = validateException(input);
    this.props.exceptions.push(exception);
    this.raise(
      envelope({
        eventType: LogisticsEvents.PodExceptionNoted,
        aggregateType: "ProofOfDelivery",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          podId: this.id,
          shipmentId: this.props.shipmentId,
          exception,
        },
      }),
    );
    return exception;
  }
}
