/**
 * Dimension catalog use-cases: registering hierarchies and loading members.
 *
 * Members arrive in bulk (a nightly sync from master-data, or a fixture) and
 * must be loaded parent-first. The service sorts by hierarchy depth before
 * writing so callers can hand over an unordered list.
 */
import {
  ConflictError,
  envelope,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { Dimension, type DefineDimensionInput, type DimensionMember } from "../domain/dimension.js";
import { DefinitionError } from "../domain/errors.js";
import { ReportingEventTypes } from "../domain/events.js";
import type { DimensionRepository } from "../domain/repositories.js";
import type { Outbox } from "./ports.js";

export interface MemberInput {
  key: string;
  label: string;
  levelKey?: string;
  parentKey?: string;
  attributes?: Readonly<Record<string, string>>;
}

export class DimensionService {
  constructor(
    private readonly dimensions: DimensionRepository,
    private readonly outbox: Outbox,
  ) {}

  async registerDimension(ctx: TenantContext, input: DefineDimensionInput): Promise<Dimension> {
    const existing = await this.dimensions.findByKey(ctx.tenantId, input.key);
    if (existing) throw new ConflictError(`dimension '${input.key}' already exists`);
    const dimension = Dimension.define(ctx.tenantId, input);
    await this.dimensions.save(dimension);
    await this.outbox.append(dimension.pullEvents());
    return dimension;
  }

  async getDimension(ctx: TenantContext, key: string): Promise<Dimension> {
    const dimension = await this.dimensions.findByKey(ctx.tenantId, key);
    if (!dimension) throw new NotFoundError("Dimension", key);
    return dimension;
  }

  async listDimensions(ctx: TenantContext): Promise<Dimension[]> {
    return this.dimensions.list(ctx.tenantId);
  }

  /**
   * Upserts members, ordered so a parent is always written before its
   * children. Members referencing an unknown level or a missing parent are
   * reported together rather than one exception per run.
   */
  async loadMembers(
    ctx: TenantContext,
    key: string,
    members: readonly MemberInput[],
  ): Promise<{ dimension: Dimension; loaded: DimensionMember[] }> {
    const dimension = await this.getDimension(ctx, key);
    const depthOf = (member: MemberInput): number =>
      dimension.level(member.levelKey ?? dimension.leafLevel.key)?.depth ?? Number.MAX_SAFE_INTEGER;

    const ordered = [...members].sort((a, b) => depthOf(a) - depthOf(b));
    const loaded: DimensionMember[] = [];
    const failures: string[] = [];
    for (const member of ordered) {
      try {
        loaded.push(dimension.upsertMember(member));
      } catch (error) {
        failures.push(`${member.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      throw new DefinitionError(
        `${failures.length} of ${members.length} members could not be loaded into '${key}'`,
        { failures },
      );
    }

    dimension.pullEvents();
    await this.dimensions.save(dimension);
    await this.outbox.append([
      envelope({
        eventType: ReportingEventTypes.DimensionMembersLoaded,
        aggregateType: "Dimension",
        aggregateId: dimension.id,
        tenantId: ctx.tenantId,
        payload: { key, loaded: loaded.length, total: dimension.memberCount },
      }),
    ]);
    return { dimension, loaded };
  }

  /** Dimension catalog keyed by dimension key, as the engine wants it. */
  async catalog(ctx: TenantContext): Promise<Map<string, Dimension>> {
    const all = await this.dimensions.list(ctx.tenantId);
    return new Map(all.map((dimension) => [dimension.key, dimension]));
  }

  /** Members of a level, with their ancestors — used to build filter pickers. */
  async browse(
    ctx: TenantContext,
    key: string,
    levelKey?: string,
  ): Promise<{ member: DimensionMember; path: string[] }[]> {
    const dimension = await this.getDimension(ctx, key);
    const level = levelKey ?? dimension.leafLevel.key;
    if (!dimension.hasLevel(level)) {
      throw new NotFoundError("DimensionLevel", `${key}.${level}`);
    }
    return dimension
      .members(level)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((member) => ({
        member,
        path: dimension
          .ancestry(member.key)
          .reverse()
          .map((ancestor) => ancestor.label),
      }));
  }
}
