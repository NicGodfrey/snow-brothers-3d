/**
 * Route rule management and evaluation.
 *
 * `resolve()` is the read path used by the relay on every published event, so
 * it stays allocation-light: repository filtering by topic first, content
 * filters second.
 */
import {
  ConflictError,
  NotFoundError,
  type EventEnvelope,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { FilterExpression } from "../domain/filter.js";
import type { RouteRuleRepository } from "../domain/repositories.js";
import {
  compareRules,
  RouteRule,
  type RouteDestination,
  type RouteDestinationType,
} from "../domain/routing.js";
import type { TransformSpec } from "../domain/transform.js";
import type { Clock, EventPublisher } from "./ports.js";

export interface ResolvedRoute {
  readonly rule: RouteRule;
  readonly destination: RouteDestination;
  readonly payload: unknown;
}

export interface CreateRouteCommand {
  name: string;
  eventPatterns: readonly string[];
  destination: RouteDestination;
  description?: string;
  filter?: FilterExpression;
  transform?: TransformSpec;
  priority?: number;
  enabled?: boolean;
}

export class RoutingService {
  constructor(
    private readonly rules: RouteRuleRepository,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, cmd: CreateRouteCommand): Promise<RouteRule> {
    const existing = await this.rules.findByName(ctx.tenantId, cmd.name.trim());
    if (existing) throw new ConflictError(`A route rule named '${cmd.name}' already exists`);
    const rule = RouteRule.create({ tenantId: ctx.tenantId, ...cmd });
    await this.flush(rule);
    return rule;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<RouteRule> {
    const rule = await this.rules.findById(ctx.tenantId, id);
    if (!rule) throw new NotFoundError("RouteRule", id);
    return rule;
  }

  async list(
    ctx: TenantContext,
    filter?: { enabled?: boolean; destinationType?: RouteDestinationType },
  ): Promise<RouteRule[]> {
    return this.rules.list(ctx.tenantId, filter);
  }

  async update(
    ctx: TenantContext,
    id: Ulid,
    changes: Parameters<RouteRule["update"]>[0],
  ): Promise<RouteRule> {
    const rule = await this.get(ctx, id);
    rule.update(changes);
    await this.flush(rule);
    return rule;
  }

  async enable(ctx: TenantContext, id: Ulid): Promise<RouteRule> {
    const rule = await this.get(ctx, id);
    rule.enable();
    await this.flush(rule);
    return rule;
  }

  async disable(ctx: TenantContext, id: Ulid): Promise<RouteRule> {
    const rule = await this.get(ctx, id);
    rule.disable();
    await this.flush(rule);
    return rule;
  }

  async delete(ctx: TenantContext, id: Ulid): Promise<void> {
    const rule = await this.get(ctx, id);
    if (rule.enabled) throw new ConflictError("Disable the route rule before deleting it");
    await this.rules.delete(ctx.tenantId, rule.id);
  }

  /**
   * Every rule that applies to an event, in evaluation order, with its
   * rendered payload. Match statistics are recorded as a side effect.
   */
  async resolve(event: EventEnvelope, options: { recordMatch?: boolean } = {}): Promise<ResolvedRoute[]> {
    const candidates = await this.rules.listMatching(event.tenantId, event.eventType);
    const applicable = candidates.filter((rule) => rule.matches(event)).sort(compareRules);
    const resolved: ResolvedRoute[] = [];
    for (const rule of applicable) {
      resolved.push({ rule, destination: rule.destination, payload: rule.render(event) });
      if (options.recordMatch !== false) {
        rule.recordMatch(this.clock.now());
        await this.rules.save(rule);
      }
    }
    return resolved;
  }

  /** Dry run for the API: what would this event do, without recording anything. */
  async preview(
    ctx: TenantContext,
    event: EventEnvelope,
  ): Promise<{ rule: RouteRule; destination: RouteDestination; payload: unknown }[]> {
    if (event.tenantId !== ctx.tenantId) {
      throw new ConflictError("Cannot preview routing for another tenant's event");
    }
    return this.resolve(event, { recordMatch: false });
  }

  private async flush(rule: RouteRule): Promise<void> {
    await this.rules.save(rule);
    await this.publisher.publishAll(rule.pullEvents());
  }
}
