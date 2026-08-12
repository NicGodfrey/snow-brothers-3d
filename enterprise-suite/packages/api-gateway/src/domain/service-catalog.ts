import { ValidationError, UnknownUpstreamError } from "./errors.js";

export type SystemName = "ERP" | "SRM" | "PRM" | "Platform" | "Apps";

export interface UpstreamService {
  readonly id: string;
  readonly label: string;
  readonly system: SystemName;
  /** Origin used when forwarding, e.g. `http://127.0.0.1:4103`. */
  readonly baseUrl: string;
  /** Public path prefix owned by the service, e.g. `/api/plm`. */
  readonly prefix: string;
  readonly version: string;
  /** Readiness of a critical service gates the gateway's own readiness. */
  readonly critical: boolean;
  readonly healthPath: string;
  readonly readyPath: string;
  readonly openapiPath: string;
  readonly owner?: string;
  readonly tags?: readonly string[];
  /** Set when the upstream is not deployed yet; probes report `unknown`. */
  readonly planned?: boolean;
}

export interface UpstreamServiceInput
  extends Omit<UpstreamService, "healthPath" | "readyPath" | "openapiPath" | "critical" | "version"> {
  readonly healthPath?: string;
  readonly readyPath?: string;
  readonly openapiPath?: string;
  readonly critical?: boolean;
  readonly version?: string;
}

const ID_RE = /^[a-z][a-z0-9-]*$/;

export function defineService(input: UpstreamServiceInput): UpstreamService {
  if (!ID_RE.test(input.id)) {
    throw ValidationError.single("id", "must be kebab-case, e.g. product-plm");
  }
  if (!input.prefix.startsWith("/")) {
    throw ValidationError.single("prefix", `must start with "/" (got "${input.prefix}")`);
  }
  if (input.prefix.endsWith("/")) {
    throw ValidationError.single("prefix", "must not end with a slash");
  }
  try {
    // eslint-disable-next-line no-new
    new URL(input.baseUrl);
  } catch {
    throw ValidationError.single("baseUrl", `must be an absolute URL (got "${input.baseUrl}")`);
  }
  return {
    ...input,
    version: input.version ?? "0.1.0",
    critical: input.critical ?? false,
    healthPath: input.healthPath ?? "/health",
    readyPath: input.readyPath ?? "/health",
    openapiPath: input.openapiPath ?? "/openapi.json",
  };
}

/** Registry of upstreams the gateway is allowed to talk to. */
export class ServiceCatalog {
  private readonly services = new Map<string, UpstreamService>();

  constructor(services: readonly UpstreamService[] = []) {
    this.registerAll(services);
  }

  register(service: UpstreamService): this {
    const clash = [...this.services.values()].find(
      (s) => s.prefix === service.prefix && s.id !== service.id,
    );
    if (clash) {
      throw ValidationError.single(
        "prefix",
        `"${service.prefix}" is already owned by ${clash.id}`,
      );
    }
    this.services.set(service.id, service);
    return this;
  }

  registerAll(services: readonly UpstreamService[]): this {
    for (const service of services) this.register(service);
    return this;
  }

  get(id: string): UpstreamService | undefined {
    return this.services.get(id);
  }

  require(id: string): UpstreamService {
    const service = this.services.get(id);
    if (!service) throw new UnknownUpstreamError(id);
    return service;
  }

  has(id: string): boolean {
    return this.services.has(id);
  }

  ids(): Set<string> {
    return new Set(this.services.keys());
  }

  list(): UpstreamService[] {
    return [...this.services.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  bySystem(system: SystemName): UpstreamService[] {
    return this.list().filter((s) => s.system === system);
  }

  critical(): UpstreamService[] {
    return this.list().filter((s) => s.critical);
  }

  /** Longest-prefix owner of a public path, used by catch-all proxying. */
  resolvePrefix(path: string): UpstreamService | undefined {
    let best: UpstreamService | undefined;
    for (const service of this.services.values()) {
      if (path === service.prefix || path.startsWith(`${service.prefix}/`)) {
        if (!best || service.prefix.length > best.prefix.length) best = service;
      }
    }
    return best;
  }

  get size(): number {
    return this.services.size;
  }
}
