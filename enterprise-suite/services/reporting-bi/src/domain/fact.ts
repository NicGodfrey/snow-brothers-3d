/**
 * Fact records — the atomic rows of the warehouse.
 *
 * A fact is immutable: it records that something measurable happened at an
 * instant, keyed by dimension member keys and carrying numeric measures.
 * Corrections arrive as new facts (a reversal), never as updates, which is
 * what lets a query at any grain be a pure fold over rows.
 *
 * Every fact keeps a pointer back to the domain event it was derived from.
 * That pointer is the idempotency key for ingest and the audit trail when
 * someone asks "why does this number say 41?".
 */
import {
  brand,
  newId,
  type CurrencyCode,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { IngestError } from "./errors.js";

/** Bucket label for dimension values a source event did not carry. */
export const UNKNOWN_MEMBER = "(unknown)";

export interface FactSource {
  readonly eventId: Ulid;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: Ulid;
  readonly ingestedAt: IsoDateTime;
  /** Mapping revision, so a re-map can be told apart from the original. */
  readonly mappingVersion: number;
}

export interface FactRecord {
  readonly factId: Ulid;
  readonly tenantId: TenantId;
  /** Fact table / cube name this row belongs to, e.g. "sales_orders". */
  readonly cube: string;
  readonly occurredAt: IsoDateTime;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly measures: Readonly<Record<string, number>>;
  /** Present when any measure is in currency minor units. */
  readonly currency?: CurrencyCode;
  readonly source: FactSource;
}

export interface NewFactInput {
  tenantId: TenantId;
  cube: string;
  occurredAt: IsoDateTime;
  dimensions: Readonly<Record<string, string | number | boolean | null | undefined>>;
  measures: Readonly<Record<string, number>>;
  currency?: string;
  source: FactSource;
}

/**
 * Builds a validated fact. Dimension values are coerced to strings and
 * blanks collapse to `(unknown)` so grouping never produces both an ""
 * bucket and a null bucket for the same missing attribute.
 */
export function createFact(input: NewFactInput): FactRecord {
  if (!input.cube.trim()) throw new IngestError("fact requires a cube name");

  const dimensions: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input.dimensions)) {
    if (raw === undefined || raw === null || raw === "") {
      dimensions[key] = UNKNOWN_MEMBER;
      continue;
    }
    dimensions[key] = typeof raw === "string" ? raw : String(raw);
  }

  const measures: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.measures)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new IngestError(
        `measure '${key}' of ${input.cube} must be a finite number, got ${String(value)}`,
        { cube: input.cube, measure: key, eventId: input.source.eventId },
      );
    }
    measures[key] = value;
  }

  return {
    factId: newId("fact"),
    tenantId: input.tenantId,
    cube: input.cube,
    occurredAt: input.occurredAt,
    dimensions,
    measures,
    currency: input.currency ? brand<string, "CurrencyCode">(input.currency.toUpperCase()) : undefined,
    source: input.source,
  };
}

/**
 * Why an inbound event never became a fact. Kept rather than dropped: an
 * empty dashboard with a full dead-letter table is a diagnosable problem,
 * an empty dashboard with nothing behind it is not.
 */
export type DeadLetterReason = "no-mapping" | "invalid-payload" | "mapping-failed";

export interface DeadLetterRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly eventId: Ulid;
  readonly eventType: string;
  readonly reason: DeadLetterReason;
  readonly message: string;
  readonly payload: unknown;
  readonly recordedAt: IsoDateTime;
}

export function deadLetter(input: {
  tenantId: TenantId;
  eventId: Ulid;
  eventType: string;
  reason: DeadLetterReason;
  message: string;
  payload: unknown;
  recordedAt: IsoDateTime;
}): DeadLetterRecord {
  return { id: newId("dlq"), ...input };
}

/**
 * Per-source ingest progress. `lastOccurredAt` is the freshness signal
 * dashboards show ("sales data as of 09:42"), `eventCount` the volume one.
 */
export interface IngestWatermark {
  readonly tenantId: TenantId;
  /** Source context prefix of the event type, e.g. "sales", "finance". */
  readonly source: string;
  readonly lastEventId: Ulid;
  readonly lastEventType: string;
  readonly lastOccurredAt: IsoDateTime;
  readonly lastIngestedAt: IsoDateTime;
  readonly eventCount: number;
  readonly factCount: number;
}

/** The bounded context an event type belongs to ("sales.order.created" -> "sales"). */
export function sourceContextOf(eventType: string): string {
  const [context] = eventType.split(".");
  return context && context.length > 0 ? context : "unknown";
}

/** Total of one measure across facts — the building block every rollup uses. */
export function sumMeasure(facts: readonly FactRecord[], field: string): number {
  let total = 0;
  for (const fact of facts) {
    const value = fact.measures[field];
    if (typeof value === "number") total += value;
  }
  return total;
}
