/**
 * Route rules: the wiring table between events and destinations.
 *
 * Webhook subscriptions already carry their own patterns, so a route rule is
 * for everything beyond plain fan-out: sending an event to a partner adapter,
 * re-publishing it on the bus under a different topic (anti-corruption
 * translation between bounded contexts), or narrowing/reshaping a payload for
 * one specific consumer.
 *
 * Rules are evaluated in priority order (highest first, then specificity of
 * the pattern), which makes overlapping rules deterministic.
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type EventEnvelope,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { matchAnyTopic, parseTopicPattern, patternSpecificity } from "@enterprise-suite/event-bus";
import { IntegrationEventTypes } from "./events.js";
import { evaluateFilter, validateFilterExpression, type FilterExpression } from "./filter.js";
import { applyTransform, validateTransformSpec, type TransformSpec } from "./transform.js";

export type RouteDestinationType = "webhook" | "adapter" | "bus";

export type RouteDestination =
  | { readonly type: "webhook"; readonly subscriptionId: Ulid }
  | { readonly type: "adapter"; readonly adapterId: Ulid }
  | { readonly type: "bus"; readonly topic: string };

interface RouteRuleProps {
  name: string;
  description?: string;
  eventPatterns: string[];
  destination: RouteDestination;
  filter?: FilterExpression;
  transform?: TransformSpec;
  enabled: boolean;
  priority: number;
  matchCount: number;
  lastMatchedAt?: IsoDateTime;
}

/**
 * Evaluation context for filters and transforms. Envelope metadata sits at
 * the top level so rules can read `eventType` or `payload.total` directly.
 */
export function routingContext(event: EventEnvelope): Record<string, unknown> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    schemaVersion: event.schemaVersion,
    correlationId: event.correlationId,
    causationId: event.causationId,
    payload: event.payload,
    event,
  };
}

function assertDestination(destination: RouteDestination): RouteDestination {
  switch (destination?.type) {
    case "webhook":
      if (!destination.subscriptionId) {
        throw new DomainError("webhook destination requires subscriptionId", "VALIDATION");
      }
      return destination;
    case "adapter":
      if (!destination.adapterId) {
        throw new DomainError("adapter destination requires adapterId", "VALIDATION");
      }
      return destination;
    case "bus":
      parseTopicPattern(destination.topic);
      if (destination.topic.includes("*")) {
        throw new DomainError("bus destination topic must be concrete (no wildcards)", "VALIDATION");
      }
      return destination;
    default:
      throw new DomainError("destination.type must be webhook, adapter or bus", "VALIDATION");
  }
}

export class RouteRule extends AggregateRoot<RouteRuleProps> {
  private constructor(tenantId: TenantId, props: RouteRuleProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    name: string;
    eventPatterns: readonly string[];
    destination: RouteDestination;
    description?: string;
    filter?: FilterExpression;
    transform?: TransformSpec;
    priority?: number;
    enabled?: boolean;
  }): RouteRule {
    if (!input.name.trim()) throw new DomainError("name is required", "VALIDATION");
    if (input.eventPatterns.length === 0) {
      throw new DomainError("at least one event pattern is required", "VALIDATION");
    }
    for (const pattern of input.eventPatterns) parseTopicPattern(pattern);
    const priority = input.priority ?? 100;
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      throw new DomainError("priority must be an integer between 0 and 1000", "VALIDATION");
    }

    const rule = new RouteRule(input.tenantId, {
      name: input.name.trim(),
      description: input.description?.trim(),
      eventPatterns: [...new Set(input.eventPatterns.map((p) => p.trim()))],
      destination: assertDestination(input.destination),
      filter: input.filter ? validateFilterExpression(input.filter) : undefined,
      transform: input.transform ? validateTransformSpec(input.transform) : undefined,
      enabled: input.enabled ?? true,
      priority,
      matchCount: 0,
    });
    rule.raise(
      envelope({
        eventType: IntegrationEventTypes.RouteRuleCreated,
        aggregateType: "RouteRule",
        aggregateId: rule.id,
        tenantId: input.tenantId,
        payload: {
          name: rule.props.name,
          eventPatterns: rule.props.eventPatterns,
          destination: rule.props.destination,
          priority,
        },
      }),
    );
    return rule;
  }

  static rehydrate(
    tenantId: TenantId,
    props: RouteRuleProps,
    existing: Partial<EntityProps>,
  ): RouteRule {
    return new RouteRule(tenantId, props, existing);
  }

  get name(): string { return this.props.name; }
  get eventPatterns(): readonly string[] { return this.props.eventPatterns; }
  get destination(): RouteDestination { return this.props.destination; }
  get filter(): FilterExpression | undefined { return this.props.filter; }
  get transform(): TransformSpec | undefined { return this.props.transform; }
  get enabled(): boolean { return this.props.enabled; }
  get priority(): number { return this.props.priority; }
  get matchCount(): number { return this.props.matchCount; }
  get lastMatchedAt(): IsoDateTime | undefined { return this.props.lastMatchedAt; }

  /** Tie-breaker within a priority band: the most specific pattern wins. */
  get specificity(): number {
    return Math.max(...this.props.eventPatterns.map(patternSpecificity));
  }

  matches(event: EventEnvelope): boolean {
    if (!this.props.enabled) return false;
    if (event.tenantId !== this.tenantId) return false;
    if (!matchAnyTopic(this.props.eventPatterns, event.eventType)) return false;
    return evaluateFilter(this.props.filter, routingContext(event));
  }

  /** Payload to hand to the destination: transformed, or the raw event payload. */
  render(event: EventEnvelope): unknown {
    if (!this.props.transform) return event.payload;
    return applyTransform(this.props.transform, routingContext(event));
  }

  recordMatch(now: IsoDateTime): void {
    this.props.matchCount += 1;
    this.props.lastMatchedAt = now;
    this.touch();
  }

  update(input: {
    name?: string;
    description?: string;
    eventPatterns?: readonly string[];
    filter?: FilterExpression | null;
    transform?: TransformSpec | null;
    priority?: number;
  }): void {
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new DomainError("name cannot be empty", "VALIDATION");
      this.props.name = input.name.trim();
    }
    if (input.description !== undefined) this.props.description = input.description.trim();
    if (input.eventPatterns !== undefined) {
      if (input.eventPatterns.length === 0) {
        throw new DomainError("at least one event pattern is required", "VALIDATION");
      }
      for (const pattern of input.eventPatterns) parseTopicPattern(pattern);
      this.props.eventPatterns = [...new Set(input.eventPatterns.map((p) => p.trim()))];
    }
    if (input.filter !== undefined) {
      this.props.filter = input.filter === null ? undefined : validateFilterExpression(input.filter);
    }
    if (input.transform !== undefined) {
      this.props.transform =
        input.transform === null ? undefined : validateTransformSpec(input.transform);
    }
    if (input.priority !== undefined) {
      if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 1000) {
        throw new DomainError("priority must be an integer between 0 and 1000", "VALIDATION");
      }
      this.props.priority = input.priority;
    }
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.RouteRuleUpdated,
        aggregateType: "RouteRule",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, priority: this.props.priority },
      }),
    );
  }

  enable(): void {
    if (this.props.enabled) throw new ConflictError("Route rule is already enabled");
    this.props.enabled = true;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.RouteRuleEnabled,
        aggregateType: "RouteRule",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name },
      }),
    );
  }

  disable(): void {
    if (!this.props.enabled) throw new ConflictError("Route rule is already disabled");
    this.props.enabled = false;
    this.raise(
      envelope({
        eventType: IntegrationEventTypes.RouteRuleDisabled,
        aggregateType: "RouteRule",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name },
      }),
    );
  }
}

/** Highest priority first, then most specific pattern, then oldest rule. */
export function compareRules(a: RouteRule, b: RouteRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.specificity !== b.specificity) return b.specificity - a.specificity;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
