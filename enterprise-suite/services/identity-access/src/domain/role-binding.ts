import {
  AggregateRoot,
  ConflictError,
  type IsoDateTime,
  type RoleCode,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "./errors.js";
import { IDENTITY_EVENT, identityEvent } from "./events.js";
import { newBindingId } from "./ids.js";
import { ROOT_SCOPE, scopeCovers, type ScopePath } from "./scope.js";
import { subjectKey, type SubjectRef } from "./subject.js";

export type BindingStatus = "active" | "revoked";

interface RoleBindingProps {
  subject: SubjectRef;
  roleCode: RoleCode;
  scope: ScopePath;
  status: BindingStatus;
  validFrom: IsoDateTime;
  validUntil?: IsoDateTime;
  grantedBy?: Ulid;
  reason?: string;
  /** When true the holder may re-grant this role at the same or narrower scope. */
  delegable: boolean;
  revokedAt?: IsoDateTime;
  revokedBy?: Ulid;
  revokedReason?: string;
}

/**
 * Binds one role to one subject at one scope for a time window. Everything about "who
 * can do what" comes from these records plus the roles they point at.
 */
export class RoleBinding extends AggregateRoot<RoleBindingProps> {
  private constructor(
    tenantId: TenantId,
    props: RoleBindingProps,
    id?: Ulid,
    createdAt?: IsoDateTime,
  ) {
    super(tenantId, props, { id: id ?? newBindingId(), createdAt });
  }

  static grant(input: {
    tenantId: TenantId;
    subject: SubjectRef;
    roleCode: RoleCode;
    scope?: ScopePath;
    validFrom: IsoDateTime;
    validUntil?: IsoDateTime;
    grantedBy?: Ulid;
    reason?: string;
    delegable?: boolean;
  }): RoleBinding {
    if (input.validUntil && Date.parse(input.validUntil) <= Date.parse(input.validFrom)) {
      throw new IdentityError(
        "Binding validUntil must be after validFrom",
        IDENTITY_ERROR.invalidUserState,
        422,
      );
    }
    const binding = new RoleBinding(input.tenantId, {
      subject: input.subject,
      roleCode: input.roleCode,
      scope: input.scope ?? ROOT_SCOPE,
      status: "active",
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      grantedBy: input.grantedBy,
      reason: input.reason,
      delegable: input.delegable ?? false,
    });
    binding.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.bindingGranted,
        aggregateType: "role_binding",
        aggregateId: binding.id,
        tenantId: binding.tenantId,
        payload: {
          subject: binding.props.subject,
          roleCode: binding.props.roleCode,
          scope: binding.props.scope,
          validUntil: binding.props.validUntil,
          grantedBy: binding.props.grantedBy,
          reason: binding.props.reason,
        },
      }),
    );
    return binding;
  }

  get subject(): SubjectRef {
    return this.props.subject;
  }

  get roleCode(): RoleCode {
    return this.props.roleCode;
  }

  get scope(): ScopePath {
    return this.props.scope;
  }

  get status(): BindingStatus {
    return this.props.status;
  }

  get validFrom(): IsoDateTime {
    return this.props.validFrom;
  }

  get validUntil(): IsoDateTime | undefined {
    return this.props.validUntil;
  }

  get delegable(): boolean {
    return this.props.delegable;
  }

  get grantedBy(): Ulid | undefined {
    return this.props.grantedBy;
  }

  isActiveAt(now: IsoDateTime): boolean {
    if (this.props.status !== "active") return false;
    const at = Date.parse(now);
    if (at < Date.parse(this.props.validFrom)) return false;
    if (this.props.validUntil && at >= Date.parse(this.props.validUntil)) return false;
    return true;
  }

  isExpiredAt(now: IsoDateTime): boolean {
    return (
      this.props.status === "active" &&
      this.props.validUntil !== undefined &&
      Date.parse(now) >= Date.parse(this.props.validUntil)
    );
  }

  /** True when this binding's scope covers the requested scope. */
  covers(requested: ScopePath): boolean {
    return scopeCovers(this.props.scope, requested);
  }

  revoke(input: { at: IsoDateTime; by?: Ulid; reason?: string }): void {
    if (this.props.status === "revoked") {
      throw new ConflictError(`Binding ${this.id} is already revoked`);
    }
    this.props.status = "revoked";
    this.props.revokedAt = input.at;
    this.props.revokedBy = input.by;
    this.props.revokedReason = input.reason;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.bindingRevoked,
        aggregateType: "role_binding",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          subject: this.props.subject,
          roleCode: this.props.roleCode,
          scope: this.props.scope,
          reason: input.reason,
        },
      }),
    );
  }

  extend(validUntil: IsoDateTime | undefined): void {
    if (this.props.status !== "active") {
      throw new IdentityError(
        `Cannot extend a ${this.props.status} binding`,
        IDENTITY_ERROR.bindingRevoked,
        409,
      );
    }
    if (validUntil && Date.parse(validUntil) <= Date.parse(this.props.validFrom)) {
      throw new IdentityError(
        "Binding validUntil must be after validFrom",
        IDENTITY_ERROR.invalidUserState,
        422,
      );
    }
    this.props.validUntil = validUntil;
    this.raise(
      identityEvent({
        eventType: IDENTITY_EVENT.bindingExtended,
        aggregateType: "role_binding",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          subject: this.props.subject,
          roleCode: this.props.roleCode,
          scope: this.props.scope,
          validUntil,
        },
      }),
    );
  }

  describe(): string {
    return `${subjectKey(this.props.subject)} -> ${this.props.roleCode} @ ${this.props.scope}`;
  }
}
