import { NotFoundError, type TenantId } from "@enterprise-suite/shared-kernel";
import { DuplicateError } from "../domain/errors.js";
import {
  bucketFor,
  FeatureFlag,
  type CreateFlagInput,
  type Evaluation,
  type EvaluationContext,
  type FlagValue,
  type TargetingRule,
  type TargetingRuleInput,
} from "../domain/feature-flag.js";
import type { AuditService } from "./audit-service.js";
import type { TenantService } from "./tenant-service.js";
import type { Clock, CommandContext, FeatureFlagRepository, Outbox } from "./ports.js";

/**
 * Feature flag administration and the evaluation read path.
 *
 * Evaluation never fails: an unknown key returns the caller's fallback with
 * reason `unknown-flag` rather than throwing, because a flag lookup on a hot
 * path must not be able to take a service down.
 */

export interface BulkEvaluation {
  readonly subject: string;
  readonly evaluatedAt: string;
  readonly flags: Record<string, FlagValue>;
  readonly detail: Evaluation[];
}

export class FeatureFlagService {
  constructor(
    private readonly flags: FeatureFlagRepository,
    private readonly tenantService: TenantService,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: CommandContext, input: CreateFlagInput): Promise<FeatureFlag> {
    const tenant = this.tenantService.requireOperational(ctx.tenantId);
    const key = input.key.trim().toLowerCase();
    if (this.flags.byKey(ctx.tenantId, key)) throw new DuplicateError("FeatureFlag", "key", key);
    tenant.assertWithinQuota("featureFlags", this.flags.count(ctx.tenantId));

    const flag = FeatureFlag.create(ctx.tenantId, input);
    this.flags.save(flag);
    await this.outbox.publish(flag.pullEvents());
    this.audit.record(ctx, {
      action: "feature-flag.create",
      resourceType: "FeatureFlag",
      resourceId: flag.key,
      after: flag.toJSON(),
    });
    return flag;
  }

  require(tenantId: TenantId, key: string): FeatureFlag {
    const flag = this.flags.byKey(tenantId, key.trim().toLowerCase());
    if (!flag) throw new NotFoundError("FeatureFlag", key);
    return flag;
  }

  list(
    tenantId: TenantId,
    filter: { enabled?: boolean; tag?: string; archived?: boolean } = {},
  ): FeatureFlag[] {
    return this.flags.list(tenantId, filter);
  }

  async toggle(ctx: CommandContext, key: string, enabled: boolean): Promise<FeatureFlag> {
    const flag = this.require(ctx.tenantId, key);
    const before = { enabled: flag.enabled };
    flag.toggle(enabled, ctx.actor);
    this.flags.save(flag);
    await this.outbox.publish(flag.pullEvents());
    this.audit.record(ctx, {
      action: "feature-flag.toggle",
      resourceType: "FeatureFlag",
      resourceId: flag.key,
      before,
      after: { enabled: flag.enabled },
    });
    return flag;
  }

  async update(
    ctx: CommandContext,
    key: string,
    patch: {
      name?: string;
      description?: string;
      defaultValue?: FlagValue;
      onValue?: FlagValue;
      offValue?: FlagValue;
      rolloutPercentage?: number;
      tags?: readonly string[];
    },
  ): Promise<FeatureFlag> {
    const flag = this.require(ctx.tenantId, key);
    const before = flag.toJSON();
    flag.update(patch);
    this.flags.save(flag);
    await this.outbox.publish(flag.pullEvents());
    this.audit.record(ctx, {
      action: "feature-flag.update",
      resourceType: "FeatureFlag",
      resourceId: flag.key,
      before,
      after: flag.toJSON(),
    });
    return flag;
  }

  async upsertRule(
    ctx: CommandContext,
    key: string,
    input: TargetingRuleInput,
  ): Promise<TargetingRule> {
    const flag = this.require(ctx.tenantId, key);
    const rule = flag.upsertRule(input);
    this.flags.save(flag);
    await this.outbox.publish(flag.pullEvents());
    this.audit.record(ctx, {
      action: "feature-flag.upsert-rule",
      resourceType: "FeatureFlag",
      resourceId: `${flag.key}/${rule.id}`,
      after: rule,
    });
    return rule;
  }

  async removeRule(ctx: CommandContext, key: string, ruleId: string): Promise<FeatureFlag> {
    const flag = this.require(ctx.tenantId, key);
    flag.removeRule(ruleId);
    this.flags.save(flag);
    await this.outbox.publish(flag.pullEvents());
    this.audit.record(ctx, {
      action: "feature-flag.remove-rule",
      resourceType: "FeatureFlag",
      resourceId: `${flag.key}/${ruleId}`,
    });
    return flag;
  }

  async archive(ctx: CommandContext, key: string): Promise<FeatureFlag> {
    const flag = this.require(ctx.tenantId, key);
    flag.archive();
    this.flags.save(flag);
    await this.outbox.publish(flag.pullEvents());
    this.audit.record(ctx, {
      action: "feature-flag.archive",
      resourceType: "FeatureFlag",
      resourceId: flag.key,
    });
    return flag;
  }

  evaluate(tenantId: TenantId, key: string, context: EvaluationContext): Evaluation {
    const flag = this.flags.byKey(tenantId, key.trim().toLowerCase());
    if (!flag || flag.archived) {
      return { key, value: false, reason: "default" };
    }
    return flag.evaluate(context);
  }

  /** One round trip for a whole client bootstrap. */
  evaluateAll(tenantId: TenantId, context: EvaluationContext): BulkEvaluation {
    const detail = this.flags
      .list(tenantId, { archived: false })
      .map((flag) => flag.evaluate(context));
    return {
      subject: context.subject,
      evaluatedAt: this.clock.now(),
      flags: Object.fromEntries(detail.map((evaluation) => [evaluation.key, evaluation.value])),
      detail,
    };
  }

  /**
   * Answers "what would this subject get, and why" without recording anything.
   * The console uses it to preview a rollout before widening it.
   */
  explain(
    tenantId: TenantId,
    key: string,
    context: EvaluationContext,
  ): Evaluation & { bucketOf: number; rolloutPercentage: number; rules: number } {
    const flag = this.require(tenantId, key);
    const evaluation = flag.evaluate(context);
    return {
      ...evaluation,
      bucketOf: bucketFor(flag.key, context.subject),
      rolloutPercentage: flag.rolloutPercentage,
      rules: flag.rules.length,
    };
  }

  /** Projected split of a rollout over a sample of subjects. */
  simulate(
    tenantId: TenantId,
    key: string,
    subjects: readonly string[],
  ): { total: number; on: number; off: number; percentOn: number } {
    const flag = this.require(tenantId, key);
    const results = subjects.map((subject) => flag.evaluate({ subject }));
    const on = results.filter((result) => result.value === true || result.reason === "rule-match")
      .length;
    return {
      total: subjects.length,
      on,
      off: subjects.length - on,
      percentOn: subjects.length === 0 ? 0 : Math.round((on / subjects.length) * 100),
    };
  }
}
