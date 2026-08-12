import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  ATTRIBUTE_CODE_PATTERN,
  ATTRIBUTE_TYPES,
  type AttributeDefinitionRecord,
  type AttributeOption,
  type AttributeSetMember,
  type AttributeSetRecord,
  type AttributeType,
} from "../domain/attribute.js";
import { ValidationError, type ValidationIssue } from "../domain/errors.js";
import { PlmEventTypes } from "../domain/events.js";
import type {
  AttributeDefinitionRepository,
  AttributeSetRepository,
  Clock,
  OutboxPort,
} from "./ports.js";

export interface CreateAttributeDefinitionInput {
  readonly code: string;
  readonly name: string;
  readonly type: AttributeType;
  readonly options?: readonly AttributeOption[];
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly uom?: string;
  readonly description?: string;
}

export interface CreateAttributeSetInput {
  readonly name: string;
  readonly members: readonly AttributeSetMember[];
}

export class AttributeService {
  constructor(
    private readonly definitions: AttributeDefinitionRepository,
    private readonly sets: AttributeSetRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async createDefinition(
    ctx: TenantContext,
    input: CreateAttributeDefinitionInput,
  ): Promise<AttributeDefinitionRecord> {
    const issues: ValidationIssue[] = [];
    const code = input.code.trim().toLowerCase();
    if (!ATTRIBUTE_CODE_PATTERN.test(code)) {
      issues.push({ field: "code", message: `invalid attribute code "${input.code}"` });
    }
    if (input.name.trim().length === 0) {
      issues.push({ field: "name", message: "name is required" });
    }
    if (!ATTRIBUTE_TYPES.includes(input.type)) {
      issues.push({ field: "type", message: `unknown type "${input.type}"` });
    }
    const needsOptions = input.type === "select" || input.type === "multiselect";
    if (needsOptions && (!input.options || input.options.length === 0)) {
      issues.push({ field: "options", message: `${input.type} attributes need at least one option` });
    }
    if (!needsOptions && input.options?.length) {
      issues.push({ field: "options", message: `options are only valid on select/multiselect` });
    }
    if (input.options) {
      const codes = input.options.map((o) => o.code);
      if (new Set(codes).size !== codes.length) {
        issues.push({ field: "options", message: "option codes must be unique" });
      }
    }
    if (input.min !== undefined && input.max !== undefined && input.min > input.max) {
      issues.push({ field: "min", message: "min cannot exceed max" });
    }
    if (input.pattern !== undefined) {
      try {
        new RegExp(input.pattern);
      } catch {
        issues.push({ field: "pattern", message: "invalid regular expression" });
      }
    }
    if (issues.length > 0) throw new ValidationError("Invalid attribute definition", issues);
    if (await this.definitions.byCode(ctx.tenantId, code)) {
      throw new ConflictError(`Attribute "${code}" already exists`);
    }
    const now = this.clock.now();
    const record: AttributeDefinitionRecord = {
      id: newId("attrdef"),
      tenantId: ctx.tenantId,
      code,
      name: input.name.trim(),
      type: input.type,
      options: input.options ? [...input.options] : undefined,
      min: input.min,
      max: input.max,
      pattern: input.pattern,
      uom: input.uom as AttributeDefinitionRecord["uom"],
      description: input.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.definitions.save(record);
    await this.outbox.publish([
      envelope({
        eventType: PlmEventTypes.AttributeDefinitionCreated,
        aggregateType: "AttributeDefinition",
        aggregateId: record.id,
        tenantId: ctx.tenantId,
        payload: { attributeDefinitionId: record.id, code: record.code, type: record.type },
      }),
    ]);
    return record;
  }

  async listDefinitions(ctx: TenantContext): Promise<readonly AttributeDefinitionRecord[]> {
    return this.definitions.all(ctx.tenantId);
  }

  async createSet(ctx: TenantContext, input: CreateAttributeSetInput): Promise<AttributeSetRecord> {
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    if (input.members.length === 0) {
      throw ValidationError.single("members", "an attribute set needs at least one member");
    }
    const codes = input.members.map((m) => m.code);
    if (new Set(codes).size !== codes.length) {
      throw ValidationError.single("members", "duplicate attribute codes in set");
    }
    if (await this.sets.byName(ctx.tenantId, input.name.trim())) {
      throw new ConflictError(`Attribute set "${input.name.trim()}" already exists`);
    }
    const defs = await this.definitions.byCodes(ctx.tenantId, codes);
    const issues: ValidationIssue[] = [];
    for (const member of input.members) {
      const def = defs.get(member.code);
      if (!def) {
        issues.push({ field: member.code, message: "attribute definition does not exist" });
        continue;
      }
      // Axis attributes must have an enumerable value space so the variant
      // matrix is finite and SKUs are derivable.
      if (member.isVariantAxis && def.type !== "select") {
        issues.push({ field: member.code, message: "variant axes must be single-select attributes" });
      }
      if (member.isVariantAxis && !member.required) {
        issues.push({ field: member.code, message: "variant axes must be required" });
      }
    }
    if (issues.length > 0) throw new ValidationError("Invalid attribute set", issues);
    const now = this.clock.now();
    const record: AttributeSetRecord = {
      id: newId("attrset"),
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      members: input.members.map((m) => ({ ...m })),
      createdAt: now,
      updatedAt: now,
    };
    await this.sets.save(record);
    await this.outbox.publish([
      envelope({
        eventType: PlmEventTypes.AttributeSetCreated,
        aggregateType: "AttributeSet",
        aggregateId: record.id,
        tenantId: ctx.tenantId,
        payload: {
          attributeSetId: record.id,
          name: record.name,
          memberCodes: codes,
          axisCodes: record.members.filter((m) => m.isVariantAxis).map((m) => m.code),
        },
      }),
    ]);
    return record;
  }

  async getSet(ctx: TenantContext, id: Ulid): Promise<AttributeSetRecord> {
    const set = await this.sets.byId(ctx.tenantId, id);
    if (!set) throw new NotFoundError("AttributeSet", id);
    return set;
  }

  async listSets(ctx: TenantContext): Promise<readonly AttributeSetRecord[]> {
    return this.sets.all(ctx.tenantId);
  }
}
