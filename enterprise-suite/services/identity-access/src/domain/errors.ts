import { DomainError } from "@enterprise-suite/shared-kernel";

/**
 * Error codes are part of the service contract: HTTP clients branch on `code`,
 * never on the human-readable message.
 */
export const IDENTITY_ERROR = {
  tenantInactive: "TENANT_INACTIVE",
  tenantSlugTaken: "TENANT_SLUG_TAKEN",
  emailTaken: "EMAIL_TAKEN",
  emailDomainNotAllowed: "EMAIL_DOMAIN_NOT_ALLOWED",
  invalidEmail: "INVALID_EMAIL",
  invalidCredentials: "INVALID_CREDENTIALS",
  credentialMissing: "CREDENTIAL_MISSING",
  weakPassword: "WEAK_PASSWORD",
  passwordReused: "PASSWORD_REUSED",
  userLocked: "USER_LOCKED",
  userNotActive: "USER_NOT_ACTIVE",
  invalidUserState: "INVALID_USER_STATE",
  mfaRequired: "MFA_REQUIRED",
  unknownPermission: "UNKNOWN_PERMISSION",
  invalidPermissionKey: "INVALID_PERMISSION_KEY",
  invalidScope: "INVALID_SCOPE",
  roleCodeTaken: "ROLE_CODE_TAKEN",
  roleCycle: "ROLE_CYCLE",
  roleInUse: "ROLE_IN_USE",
  systemRoleImmutable: "SYSTEM_ROLE_IMMUTABLE",
  roleNotAssignable: "ROLE_NOT_ASSIGNABLE",
  groupCycle: "GROUP_CYCLE",
  bindingRevoked: "BINDING_REVOKED",
  bindingDuplicate: "BINDING_DUPLICATE",
  apiKeyLimitReached: "API_KEY_LIMIT_REACHED",
  apiKeyRevoked: "API_KEY_REVOKED",
  apiKeyExpired: "API_KEY_EXPIRED",
  apiKeyMalformed: "API_KEY_MALFORMED",
  ipNotAllowed: "IP_NOT_ALLOWED",
  sessionExpired: "SESSION_EXPIRED",
  sessionRevoked: "SESSION_REVOKED",
  sessionLimitReached: "SESSION_LIMIT_REACHED",
  refreshNotEnabled: "REFRESH_NOT_ENABLED",
  authorizationDenied: "AUTHORIZATION_DENIED",
} as const;

export type IdentityErrorCode = (typeof IDENTITY_ERROR)[keyof typeof IDENTITY_ERROR];

export class IdentityError extends DomainError {
  constructor(message: string, code: IdentityErrorCode, status = 400, details?: unknown) {
    super(message, code, status, details);
    this.name = "IdentityError";
  }
}

export class AuthenticationError extends IdentityError {
  constructor(message = "Invalid credentials", code: IdentityErrorCode = IDENTITY_ERROR.invalidCredentials) {
    super(message, code, 401);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationDeniedError extends IdentityError {
  constructor(
    readonly permission: string,
    readonly scope: string,
    readonly reason: string,
  ) {
    super(
      `Permission "${permission}" denied at scope "${scope}" (${reason})`,
      IDENTITY_ERROR.authorizationDenied,
      403,
      { permission, scope, reason },
    );
    this.name = "AuthorizationDeniedError";
  }
}

export class ValidationError extends IdentityError {
  constructor(message: string, code: IdentityErrorCode, details?: unknown) {
    super(message, code, 422, details);
    this.name = "ValidationError";
  }
}
