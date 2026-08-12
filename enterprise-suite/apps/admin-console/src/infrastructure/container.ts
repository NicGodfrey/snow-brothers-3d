import { AuditService } from "../application/audit-service.js";
import { FeatureFlagService } from "../application/feature-flag-service.js";
import type { Clock, SecretGenerator, Signer, WebhookSender } from "../application/ports.js";
import { ReferenceDataService } from "../application/reference-data-service.js";
import { RoleService } from "../application/role-service.js";
import { TenantService } from "../application/tenant-service.js";
import { UserService } from "../application/user-service.js";
import { WebhookService } from "../application/webhook-service.js";
import { HmacSigner, RandomSecretGenerator } from "./crypto.js";
import {
  InMemoryAuditRepository,
  InMemoryDeliveryRepository,
  InMemoryFeatureFlagRepository,
  InMemoryOutbox,
  InMemoryReferenceDataRepository,
  InMemoryRoleRepository,
  InMemoryTenantRepository,
  InMemoryUserRepository,
  InMemoryWebhookRepository,
  SystemClock,
} from "./memory-repositories.js";
import { HttpWebhookSender } from "./webhook-sender.js";

/** Composition root: repositories, ports and application services. */
export interface AdminContainer {
  readonly repos: {
    readonly tenants: InMemoryTenantRepository;
    readonly users: InMemoryUserRepository;
    readonly roles: InMemoryRoleRepository;
    readonly referenceData: InMemoryReferenceDataRepository;
    readonly webhooks: InMemoryWebhookRepository;
    readonly deliveries: InMemoryDeliveryRepository;
    readonly flags: InMemoryFeatureFlagRepository;
    readonly audit: InMemoryAuditRepository;
  };
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly secrets: SecretGenerator;
  readonly signer: Signer;
  readonly sender: WebhookSender;
  readonly services: {
    readonly audit: AuditService;
    readonly tenant: TenantService;
    readonly role: RoleService;
    readonly user: UserService;
    readonly referenceData: ReferenceDataService;
    readonly webhook: WebhookService;
    readonly featureFlag: FeatureFlagService;
  };
  /** Stops the outbox → webhook bridge. */
  readonly dispose: () => void;
}

export interface ContainerOptions {
  readonly clock?: Clock;
  readonly secrets?: SecretGenerator;
  readonly signer?: Signer;
  readonly sender?: WebhookSender;
  /** Fan domain events out to matching webhook subscriptions. Default true. */
  readonly bridgeEventsToWebhooks?: boolean;
  readonly webhookTimeoutMs?: number;
}

export function createContainer(options: ContainerOptions = {}): AdminContainer {
  const clock = options.clock ?? new SystemClock();
  const secrets = options.secrets ?? new RandomSecretGenerator();
  const signer = options.signer ?? new HmacSigner();
  const sender = options.sender ?? new HttpWebhookSender(clock);
  const outbox = new InMemoryOutbox();

  const repos = {
    tenants: new InMemoryTenantRepository(),
    users: new InMemoryUserRepository(),
    roles: new InMemoryRoleRepository(),
    referenceData: new InMemoryReferenceDataRepository(),
    webhooks: new InMemoryWebhookRepository(),
    deliveries: new InMemoryDeliveryRepository(),
    flags: new InMemoryFeatureFlagRepository(),
    audit: new InMemoryAuditRepository(),
  };

  const audit = new AuditService(repos.audit, clock);
  const tenant = new TenantService(
    repos.tenants,
    repos.roles,
    repos.users,
    repos.referenceData,
    repos.webhooks,
    repos.flags,
    outbox,
    clock,
    audit,
  );
  const role = new RoleService(repos.roles, repos.users, outbox, clock, audit);
  const user = new UserService(repos.users, role, tenant, secrets, outbox, clock, audit);
  const referenceData = new ReferenceDataService(repos.referenceData, tenant, outbox, clock, audit);
  const webhook = new WebhookService(
    repos.webhooks,
    repos.deliveries,
    tenant,
    sender,
    signer,
    secrets,
    outbox,
    clock,
    audit,
    { timeoutMs: options.webhookTimeoutMs },
  );
  const featureFlag = new FeatureFlagService(repos.flags, tenant, outbox, clock, audit);

  // Domain events become webhook deliveries here, so no command handler needs
  // to know which subscriptions exist.
  const unsubscribe =
    options.bridgeEventsToWebhooks === false
      ? () => undefined
      : outbox.subscribe((event) => {
          if (event.eventType.startsWith("admin.webhook.")) return;
          webhook.enqueue(event);
        });

  return {
    repos,
    outbox,
    clock,
    secrets,
    signer,
    sender,
    services: { audit, tenant, role, user, referenceData, webhook, featureFlag },
    dispose: unsubscribe,
  };
}
