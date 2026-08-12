import { createApiClients, type ApiClients } from "../api/index.js";
import type { Transport } from "../api/types.js";
import { DashboardService } from "../application/dashboard-service.js";
import { ModuleService } from "../application/module-service.js";
import { NavigationService } from "../application/navigation-service.js";
import { PreferencesService } from "../application/preferences-service.js";
import { SearchService } from "../application/search-service.js";
import type { PortalSession } from "../domain/session.js";
import { AuthService } from "./auth/auth-service.js";
import { Directory } from "./auth/directory.js";
import { CallLog } from "./call-log.js";
import { SystemClock, type Clock } from "./clock.js";
import { loadConfig, type PortalConfig } from "./config.js";
import {
  InMemoryPreferencesRepository,
  type PreferencesRepository,
} from "./preferences-repository.js";
import { FetchTransport } from "./transport/fetch-transport.js";
import { MockTransport } from "./transport/mock-transport.js";

/**
 * Composition root.
 *
 * Session-independent collaborators are built once; anything that must carry
 * the caller's identity (the API clients and the services that use them) is
 * built per request by `forSession`, so a session's headers can never leak
 * into another request's calls.
 */

export interface SessionScope {
  readonly clients: ApiClients;
  readonly dashboard: DashboardService;
  readonly modules: ModuleService;
  readonly search: SearchService;
}

export interface PortalContainer {
  readonly config: PortalConfig;
  readonly clock: Clock;
  readonly auth: AuthService;
  readonly directory: Directory;
  readonly navigation: NavigationService;
  readonly preferences: PreferencesService;
  readonly preferencesRepository: PreferencesRepository;
  readonly transport: Transport;
  readonly callLog: CallLog;
  forSession(session: PortalSession): SessionScope;
}

export interface ContainerOverrides {
  readonly config?: Partial<PortalConfig>;
  readonly clock?: Clock;
  readonly transport?: Transport;
  readonly directory?: Directory;
  readonly preferencesRepository?: PreferencesRepository;
}

export function createContainer(overrides: ContainerOverrides = {}): PortalContainer {
  const config: PortalConfig = { ...loadConfig(), ...overrides.config };
  const clock = overrides.clock ?? new SystemClock();
  const directory = overrides.directory ?? new Directory();
  const callLog = new CallLog();

  const transport =
    overrides.transport ??
    (config.transport === "http"
      ? new FetchTransport()
      : new MockTransport({
          endpoints: config.endpoints,
          clock,
          latencyMs: config.mockLatencyMs,
        }));

  const auth = new AuthService({
    secret: config.sessionSecret,
    ttlMinutes: config.sessionTtlMinutes,
    clock,
    directory,
  });

  const preferencesRepository = overrides.preferencesRepository ?? new InMemoryPreferencesRepository();

  return {
    config,
    clock,
    auth,
    directory,
    navigation: new NavigationService(directory),
    preferences: new PreferencesService(preferencesRepository, clock),
    preferencesRepository,
    transport,
    callLog,
    forSession(session: PortalSession): SessionScope {
      const clients = createApiClients({
        endpoints: config.endpoints,
        transport,
        auth: auth.headerProvider(session),
        onCall: (record) => callLog.record(record),
        now: () => clock.epochMs(),
      });
      return {
        clients,
        dashboard: new DashboardService(clients, clock),
        modules: new ModuleService(clients),
        search: new SearchService(clients),
      };
    },
  };
}
