/**
 * Composition root. Builds one integration hub out of an event bus,
 * repositories, driver stubs and the application services. Tests, the HTTP
 * server and the demo all start here.
 */
import { InMemoryEventBus, NETWORK_RETRY_POLICY, type RetryPolicy } from "@enterprise-suite/event-bus";
import { AdapterService } from "../application/adapter-service.js";
import { DeliveryService } from "../application/delivery-service.js";
import { IdempotencyService } from "../application/idempotency-service.js";
import { InboxService } from "../application/inbox-service.js";
import { OutboxService } from "../application/outbox-service.js";
import type {
  Clock,
  EventPublisher,
  HubLogger,
  SecretGenerator,
  WebhookTransport,
  WorkerIdentity,
} from "../application/ports.js";
import { RelayService } from "../application/relay-service.js";
import { RoutingService } from "../application/routing-service.js";
import { WebhookService } from "../application/webhook-service.js";
import { createDefaultDriverRegistry, type DefaultDrivers } from "./adapters/registry.js";
import { BusEventPublisher, RecordingEventPublisher } from "./bus-publisher.js";
import { SystemClock } from "./in-memory/clock.js";
import {
  InMemoryAdapterRepository,
  InMemoryDeliveryRepository,
  InMemoryIdempotencyRepository,
  InMemoryInboxRepository,
  InMemoryOutboxRepository,
  InMemoryRouteRuleRepository,
  InMemoryWebhookSubscriptionRepository,
} from "./in-memory/repositories.js";
import { RandomSecretGenerator } from "./in-memory/secrets.js";
import { FetchWebhookTransport } from "./transport.js";

export interface IntegrationHubOptions {
  readonly clock?: Clock;
  readonly bus?: InMemoryEventBus;
  readonly transport?: WebhookTransport;
  readonly secrets?: SecretGenerator;
  readonly retry?: RetryPolicy;
  readonly worker?: WorkerIdentity;
  readonly logger?: HubLogger;
  /** Also record every published event in memory (diagnostics, tests). */
  readonly recordEvents?: boolean;
}

export interface IntegrationHubModule {
  readonly clock: Clock;
  readonly bus: InMemoryEventBus;
  readonly publisher: EventPublisher;
  readonly recorder?: RecordingEventPublisher;
  readonly transport: WebhookTransport;
  readonly drivers: DefaultDrivers;
  readonly worker: WorkerIdentity;
  readonly repos: {
    readonly outbox: InMemoryOutboxRepository;
    readonly inbox: InMemoryInboxRepository;
    readonly idempotency: InMemoryIdempotencyRepository;
    readonly subscriptions: InMemoryWebhookSubscriptionRepository;
    readonly deliveries: InMemoryDeliveryRepository;
    readonly adapters: InMemoryAdapterRepository;
    readonly routes: InMemoryRouteRuleRepository;
  };
  readonly services: {
    readonly outbox: OutboxService;
    readonly inbox: InboxService;
    readonly idempotency: IdempotencyService;
    readonly webhooks: WebhookService;
    readonly deliveries: DeliveryService;
    readonly adapters: AdapterService;
    readonly routing: RoutingService;
    readonly relay: RelayService;
  };
}

export function createIntegrationHubModule(
  options: IntegrationHubOptions = {},
): IntegrationHubModule {
  const clock = options.clock ?? new SystemClock();
  const bus = options.bus ?? new InMemoryEventBus();
  const transport = options.transport ?? new FetchWebhookTransport();
  const secrets = options.secrets ?? new RandomSecretGenerator();
  const retry = options.retry ?? NETWORK_RETRY_POLICY;
  const worker = options.worker ?? { name: "relay-1", leaseMs: 30_000 };
  const drivers = createDefaultDriverRegistry();

  const recorder = options.recordEvents ? new RecordingEventPublisher() : undefined;
  const busPublisher = new BusEventPublisher(bus);
  const publisher: EventPublisher = recorder
    ? {
        publish: async (event) => {
          recorder.events.push(event);
          await busPublisher.publish(event);
        },
        publishAll: async (events) => {
          recorder.events.push(...events);
          await busPublisher.publishAll(events);
        },
      }
    : busPublisher;

  const repos = {
    outbox: new InMemoryOutboxRepository(),
    inbox: new InMemoryInboxRepository(),
    idempotency: new InMemoryIdempotencyRepository(),
    subscriptions: new InMemoryWebhookSubscriptionRepository(),
    deliveries: new InMemoryDeliveryRepository(),
    adapters: new InMemoryAdapterRepository(),
    routes: new InMemoryRouteRuleRepository(),
  };

  const outbox = new OutboxService(repos.outbox, publisher, clock, retry);
  const inbox = new InboxService(repos.inbox, publisher, clock, retry, options.logger);
  const idempotency = new IdempotencyService(repos.idempotency, publisher, clock);
  const webhooks = new WebhookService(repos.subscriptions, publisher, clock, secrets);
  const deliveries = new DeliveryService(
    repos.deliveries,
    repos.subscriptions,
    transport,
    publisher,
    clock,
    retry,
    options.logger,
  );
  const adapters = new AdapterService(repos.adapters, drivers.registry, publisher, clock, inbox);
  const routing = new RoutingService(repos.routes, publisher, clock);
  const relay = new RelayService(
    outbox,
    publisher,
    routing,
    deliveries,
    adapters,
    clock,
    worker,
    options.logger,
  );

  return {
    clock,
    bus,
    publisher,
    recorder,
    transport,
    drivers,
    worker,
    repos,
    services: { outbox, inbox, idempotency, webhooks, deliveries, adapters, routing, relay },
  };
}
