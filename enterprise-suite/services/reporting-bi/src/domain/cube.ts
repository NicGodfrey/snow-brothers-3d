/**
 * Cube definitions — the schema of a fact table.
 *
 * A cube says which dimension keys facts of that table carry, which numeric
 * measure fields they may hold, and which upstream event types feed it. It
 * is the contract between ingest (writes facts) and query (reads them):
 * ingest cannot invent a dimension the cube never declared, and a query
 * cannot group by one either.
 *
 * Metrics are *not* listed here — they point at the cube instead, so an
 * analyst can add a metric without touching the physical schema.
 */
import {
  AggregateRoot,
  ConflictError,
  envelope,
  type EntityProps,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { assertDimensionKey } from "./dimension.js";
import { DefinitionError } from "./errors.js";
import { ReportingEventTypes } from "./events.js";
import { isTimeGrain, type TimeGrain } from "./time-grain.js";

export type CubeStatus = "draft" | "published" | "archived";

/** Binds a fact column to a dimension in the catalog. */
export interface CubeDimensionBinding {
  /** Key used inside `fact.dimensions`. */
  readonly factKey: string;
  /** Dimension in the catalog this column resolves against. */
  readonly dimensionKey: string;
  readonly label: string;
  /** Facts missing a required dimension are rejected at ingest. */
  readonly required: boolean;
}

export interface CubeMeasureField {
  readonly field: string;
  readonly label: string;
  /** Money measures are stored in integer minor units. */
  readonly isCurrency: boolean;
}

interface CubeProps {
  name: string;
  title: string;
  description?: string;
  status: CubeStatus;
  dimensions: CubeDimensionBinding[];
  measureFields: CubeMeasureField[];
  sourceEventTypes: string[];
  defaultGrain: TimeGrain;
  defaultMetrics: string[];
  /** Retention for raw facts in days; 0 means keep forever. */
  retentionDays: number;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

export function assertCubeName(name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new DefinitionError(
      `cube name '${name}' must be snake_case, start with a letter, and be 3..64 characters`,
    );
  }
  return name;
}

export interface DefineCubeInput {
  name: string;
  title: string;
  description?: string;
  defaultGrain?: TimeGrain;
  retentionDays?: number;
  dimensions?: readonly {
    factKey: string;
    dimensionKey?: string;
    label?: string;
    required?: boolean;
  }[];
  measureFields?: readonly { field: string; label?: string; isCurrency?: boolean }[];
  sourceEventTypes?: readonly string[];
  defaultMetrics?: readonly string[];
}

export class CubeDefinition extends AggregateRoot<CubeProps> {
  private constructor(tenantId: TenantId, props: CubeProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static define(tenantId: TenantId, input: DefineCubeInput): CubeDefinition {
    const name = assertCubeName(input.name);
    if (!input.title.trim()) throw new DefinitionError(`cube '${name}' needs a title`);
    if (input.defaultGrain && !isTimeGrain(input.defaultGrain)) {
      throw new DefinitionError(`cube '${name}' has unknown default grain '${input.defaultGrain}'`);
    }
    const retentionDays = input.retentionDays ?? 0;
    if (!Number.isInteger(retentionDays) || retentionDays < 0) {
      throw new DefinitionError(`cube '${name}' retentionDays must be a non-negative integer`);
    }

    const cube = new CubeDefinition(tenantId, {
      name,
      title: input.title.trim(),
      description: input.description?.trim(),
      status: "draft",
      dimensions: [],
      measureFields: [],
      sourceEventTypes: [...(input.sourceEventTypes ?? [])],
      defaultGrain: input.defaultGrain ?? "day",
      defaultMetrics: [...(input.defaultMetrics ?? [])],
      retentionDays,
    });

    for (const dimension of input.dimensions ?? []) cube.addDimension(dimension);
    for (const measure of input.measureFields ?? []) cube.addMeasureField(measure);

    cube.raise(
      envelope({
        eventType: ReportingEventTypes.CubeDefined,
        aggregateType: "CubeDefinition",
        aggregateId: cube.id,
        tenantId,
        payload: {
          name,
          dimensionCount: cube.props.dimensions.length,
          measureCount: cube.props.measureFields.length,
          sourceEventTypes: cube.props.sourceEventTypes,
        },
      }),
    );
    return cube;
  }

  static rehydrate(
    tenantId: TenantId,
    props: CubeProps,
    existing: Partial<EntityProps>,
  ): CubeDefinition {
    return new CubeDefinition(tenantId, props, existing);
  }

  get name(): string { return this.props.name; }
  get title(): string { return this.props.title; }
  get description(): string | undefined { return this.props.description; }
  get status(): CubeStatus { return this.props.status; }
  get dimensions(): readonly CubeDimensionBinding[] { return this.props.dimensions; }
  get measureFields(): readonly CubeMeasureField[] { return this.props.measureFields; }
  get sourceEventTypes(): readonly string[] { return this.props.sourceEventTypes; }
  get defaultGrain(): TimeGrain { return this.props.defaultGrain; }
  get defaultMetrics(): readonly string[] { return this.props.defaultMetrics; }
  get retentionDays(): number { return this.props.retentionDays; }

  addDimension(input: {
    factKey: string;
    dimensionKey?: string;
    label?: string;
    required?: boolean;
  }): CubeDimensionBinding {
    this.assertMutable();
    const factKey = assertDimensionKey(input.factKey);
    if (this.props.dimensions.some((d) => d.factKey === factKey)) {
      throw new ConflictError(`cube '${this.props.name}' already binds dimension '${factKey}'`);
    }
    const binding: CubeDimensionBinding = {
      factKey,
      dimensionKey: input.dimensionKey ?? factKey,
      label: input.label ?? humanize(factKey),
      required: input.required ?? false,
    };
    this.props.dimensions.push(binding);
    this.touch();
    return binding;
  }

  addMeasureField(input: { field: string; label?: string; isCurrency?: boolean }): CubeMeasureField {
    this.assertMutable();
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.field)) {
      throw new DefinitionError(`measure field '${input.field}' must be snake_case`);
    }
    if (this.props.measureFields.some((m) => m.field === input.field)) {
      throw new ConflictError(
        `cube '${this.props.name}' already declares measure field '${input.field}'`,
      );
    }
    const measure: CubeMeasureField = {
      field: input.field,
      label: input.label ?? humanize(input.field),
      isCurrency: input.isCurrency ?? input.field.endsWith("_minor"),
    };
    this.props.measureFields.push(measure);
    this.touch();
    return measure;
  }

  declareSourceEvent(eventType: string): void {
    if (!eventType.trim()) throw new DefinitionError("source event type cannot be blank");
    if (this.props.sourceEventTypes.includes(eventType)) return;
    this.props.sourceEventTypes.push(eventType);
    this.touch();
  }

  setDefaultMetrics(codes: readonly string[]): void {
    this.props.defaultMetrics = [...codes];
    this.touch();
  }

  binding(factKey: string): CubeDimensionBinding | undefined {
    return this.props.dimensions.find((d) => d.factKey === factKey);
  }

  hasDimension(factKey: string): boolean {
    return this.binding(factKey) !== undefined;
  }

  hasMeasureField(field: string): boolean {
    return this.props.measureFields.some((m) => m.field === field);
  }

  requiredDimensions(): readonly string[] {
    return this.props.dimensions.filter((d) => d.required).map((d) => d.factKey);
  }

  publish(): void {
    if (this.props.status === "published") {
      throw new ConflictError(`cube '${this.props.name}' is already published`);
    }
    if (this.props.measureFields.length === 0) {
      throw new DefinitionError(
        `cube '${this.props.name}' cannot be published without at least one measure field`,
      );
    }
    this.props.status = "published";
    this.raise(
      envelope({
        eventType: ReportingEventTypes.CubePublished,
        aggregateType: "CubeDefinition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, dimensionCount: this.props.dimensions.length },
      }),
    );
  }

  archive(reason: string): void {
    if (!reason.trim()) throw new DefinitionError("an archive reason is required");
    if (this.props.status === "archived") {
      throw new ConflictError(`cube '${this.props.name}' is already archived`);
    }
    this.props.status = "archived";
    this.raise(
      envelope({
        eventType: ReportingEventTypes.CubeArchived,
        aggregateType: "CubeDefinition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { name: this.props.name, reason: reason.trim() },
      }),
    );
  }

  private assertMutable(): void {
    if (this.props.status === "archived") {
      throw new ConflictError(`cube '${this.props.name}' is archived and cannot be changed`);
    }
  }
}

function humanize(key: string): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
