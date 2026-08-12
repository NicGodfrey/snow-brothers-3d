import { addDays, type PlanningCalendar } from "./calendar.js";
import {
  applyLotSizing,
  coverageLookaheadPeriods,
  type LotSizingRule,
} from "./lot-sizing.js";
import { roundQty, type IsoDate } from "./types.js";

/** One row of the classic MRP grid for a single weekly bucket. */
export interface MrpRow {
  readonly weekStart: IsoDate;
  readonly grossRequirement: number;
  readonly scheduledReceipts: number;
  readonly plannedReceipts: number;
  /** Projected on-hand at the END of the bucket, after all flows. */
  readonly projectedOnHand: number;
  readonly netRequirement: number;
}

export type MrpExceptionCode =
  | "RELEASE_PAST_DUE"
  | "BELOW_SAFETY_STOCK"
  | "SHORTAGE"
  | "EXPEDITE_RECEIPT"
  | "EXCESS_RECEIPT"
  | "LOT_MAX_EXCEEDED"
  | "SUPPLIER_CAPACITY_OVERLOAD";

export interface MrpException {
  readonly code: MrpExceptionCode;
  readonly severity: "WARNING" | "ERROR";
  readonly weekStart: IsoDate | null;
  readonly message: string;
}

export interface PlannedOrderProposal {
  /** Bucket index the material must be available in. */
  readonly dueIndex: number;
  readonly dueDate: IsoDate;
  /** Order start, offset by lead time; clamped into the horizon. */
  readonly releaseDate: IsoDate;
  /** Bucket index of the (clamped) release, used for BOM explosion. */
  readonly releaseIndex: number;
  readonly qty: number;
  readonly pastDue: boolean;
}

export interface NetItemInput {
  readonly sku: string;
  readonly calendar: PlanningCalendar;
  readonly onHand: number;
  readonly safetyStock: number;
  readonly leadTimeDays: number;
  readonly lotSizing: LotSizingRule;
  /** Index-aligned with calendar.weekStarts. */
  readonly grossRequirements: readonly number[];
  readonly scheduledReceipts: readonly number[];
}

export interface NetItemResult {
  readonly sku: string;
  readonly rows: readonly MrpRow[];
  readonly plannedOrders: readonly PlannedOrderProposal[];
  readonly exceptions: readonly MrpException[];
}

/**
 * Time-phased MRP netting for one item.
 *
 * For each bucket, availability is last bucket's projected on-hand plus
 * scheduled receipts. When availability minus gross demand would fall below
 * safety stock, the shortfall becomes a net requirement; lot-sizing turns it
 * into a planned receipt in the same bucket, and the order release is offset
 * backwards by the item lead time. PERIOD_ORDER_QTY additionally pulls in
 * the shortfalls of the next `periods - 1` buckets so a single order covers
 * the whole window.
 *
 * The grid follows the textbook convention that planned receipts land in the
 * bucket that needs them; orders whose release would fall before the horizon
 * are flagged RELEASE_PAST_DUE. Stock exceptions (SHORTAGE,
 * BELOW_SAFETY_STOCK, EXPEDITE_RECEIPT) are derived from a *feasibility*
 * projection in which a past-due order cannot arrive earlier than the item
 * lead time - i.e. what will really happen unless a planner intervenes.
 */
export function netItem(input: NetItemInput): NetItemResult {
  const { calendar, safetyStock, lotSizing } = input;
  const n = calendar.weekCount;
  const gross = padTo(input.grossRequirements, n);
  const scheduled = padTo(input.scheduledReceipts, n);

  const rows: MrpRow[] = [];
  const plannedOrders: PlannedOrderProposal[] = [];
  const exceptions: MrpException[] = [];
  const leadTimeBuckets = Math.ceil(input.leadTimeDays / 7);

  let onHand = input.onHand;

  for (let t = 0; t < n; t += 1) {
    const available = roundQty(onHand + scheduled[t]);
    const shortfall = roundQty(gross[t] + safetyStock - available);
    let netRequirement = 0;
    let plannedReceipt = 0;

    if (shortfall > 0) {
      netRequirement = shortfall;
      const lookahead = coverageLookaheadPeriods(lotSizing);
      const need = netRequirement + futureShortfalls(gross, scheduled, safetyStock, t, lookahead);
      const decision = applyLotSizing(lotSizing, need);
      plannedReceipt = decision.qty;
      for (const warning of decision.warnings) {
        exceptions.push({
          code: "LOT_MAX_EXCEEDED",
          severity: "WARNING",
          weekStart: calendar.weekStarts[t],
          message: `${input.sku}: ${warning}`,
        });
      }
      plannedOrders.push(buildProposal(input, calendar, t, plannedReceipt, leadTimeBuckets, exceptions));
    }

    onHand = roundQty(available + plannedReceipt - gross[t]);
    rows.push({
      weekStart: calendar.weekStarts[t],
      grossRequirement: gross[t],
      scheduledReceipts: scheduled[t],
      plannedReceipts: plannedReceipt,
      projectedOnHand: onHand,
      netRequirement,
    });
  }

  const feasibleOnHand = feasibleProjection(input, gross, scheduled, plannedOrders, leadTimeBuckets);
  detectStockExceptions(input, feasibleOnHand, exceptions);
  detectExpediteOpportunity(input, feasibleOnHand, scheduled, exceptions);
  detectExcessReceipts(input, rows, scheduled, exceptions);

  return { sku: input.sku, rows, plannedOrders, exceptions };
}

/**
 * Additional quantity needed to keep projected on-hand at safety stock for
 * buckets (t, t + lookahead], assuming the order at t brings stock exactly to
 * safety stock and no further orders are placed inside the window.
 */
function futureShortfalls(
  gross: readonly number[],
  scheduled: readonly number[],
  safetyStock: number,
  t: number,
  lookahead: number,
): number {
  let extra = 0;
  let onHand = safetyStock;
  const end = Math.min(gross.length - 1, t + lookahead);
  for (let u = t + 1; u <= end; u += 1) {
    onHand = roundQty(onHand + scheduled[u] - gross[u]);
    if (onHand < safetyStock) {
      extra = roundQty(extra + (safetyStock - onHand));
      onHand = safetyStock;
    }
  }
  return extra;
}

function buildProposal(
  input: NetItemInput,
  calendar: PlanningCalendar,
  dueIndex: number,
  qty: number,
  leadTimeBuckets: number,
  exceptions: MrpException[],
): PlannedOrderProposal {
  const dueDate = calendar.weekStarts[dueIndex];
  const idealRelease = addDays(dueDate, -input.leadTimeDays);
  const releaseIndexRaw = dueIndex - leadTimeBuckets;
  const pastDue = releaseIndexRaw < 0;
  const releaseIndex = Math.max(0, releaseIndexRaw);
  const releaseDate = pastDue ? calendar.weekStarts[0] : idealRelease;
  if (pastDue) {
    exceptions.push({
      code: "RELEASE_PAST_DUE",
      severity: "ERROR",
      weekStart: dueDate,
      message:
        `${input.sku}: order of ${qty} due ${dueDate} requires release on ${idealRelease}, ` +
        `before the planning horizon starts (${calendar.start}). Expedite or reschedule demand.`,
    });
  }
  return { dueIndex, dueDate, releaseDate, releaseIndex, qty, pastDue };
}

/**
 * End-of-bucket on-hand assuming past-due orders arrive at the earliest
 * feasible bucket (release now + lead time) instead of when they are needed.
 */
function feasibleProjection(
  input: NetItemInput,
  gross: readonly number[],
  scheduled: readonly number[],
  plannedOrders: readonly PlannedOrderProposal[],
  leadTimeBuckets: number,
): number[] {
  const n = gross.length;
  const receipts = new Array<number>(n).fill(0);
  for (const order of plannedOrders) {
    const arrival = order.pastDue ? Math.min(leadTimeBuckets, n - 1) : order.dueIndex;
    receipts[arrival] += order.qty;
  }
  const onHand: number[] = [];
  let balance = input.onHand;
  for (let t = 0; t < n; t += 1) {
    balance = roundQty(balance + scheduled[t] + receipts[t] - gross[t]);
    onHand.push(balance);
  }
  return onHand;
}

function detectStockExceptions(
  input: NetItemInput,
  feasibleOnHand: readonly number[],
  exceptions: MrpException[],
): void {
  for (let t = 0; t < feasibleOnHand.length; t += 1) {
    const weekStart = input.calendar.weekStarts[t];
    if (feasibleOnHand[t] < 0) {
      exceptions.push({
        code: "SHORTAGE",
        severity: "ERROR",
        weekStart,
        message:
          `${input.sku}: projected on-hand ${feasibleOnHand[t]} in week ${weekStart} is negative ` +
          `given feasible arrival dates; demand will be missed without expediting`,
      });
    } else if (input.safetyStock > 0 && feasibleOnHand[t] < input.safetyStock) {
      exceptions.push({
        code: "BELOW_SAFETY_STOCK",
        severity: "WARNING",
        weekStart,
        message:
          `${input.sku}: projected on-hand ${feasibleOnHand[t]} in week ${weekStart} ` +
          `is below safety stock ${input.safetyStock}`,
      });
    }
  }
}

/**
 * If the first feasibility problem happens while a scheduled receipt sits in
 * a later bucket, suggest pulling that receipt in - usually cheaper than a
 * new expedited order.
 */
function detectExpediteOpportunity(
  input: NetItemInput,
  feasibleOnHand: readonly number[],
  scheduled: readonly number[],
  exceptions: MrpException[],
): void {
  const firstProblem = feasibleOnHand.findIndex(
    (balance) => balance < 0 || (input.safetyStock > 0 && balance < input.safetyStock),
  );
  if (firstProblem < 0) return;
  for (let u = firstProblem + 1; u < scheduled.length; u += 1) {
    if (scheduled[u] > 0) {
      exceptions.push({
        code: "EXPEDITE_RECEIPT",
        severity: "WARNING",
        weekStart: input.calendar.weekStarts[u],
        message:
          `${input.sku}: scheduled receipt of ${scheduled[u]} in week ${input.calendar.weekStarts[u]} ` +
          `could be expedited to cover the shortfall in week ${input.calendar.weekStarts[firstProblem]}`,
      });
      return; // one actionable message is enough
    }
  }
}

/**
 * A receipt is excess when the projected on-hand would stay at or above
 * safety stock for the rest of the horizon even without it - candidate for
 * cancellation or push-out.
 */
function detectExcessReceipts(
  input: NetItemInput,
  rows: readonly MrpRow[],
  scheduled: readonly number[],
  exceptions: MrpException[],
): void {
  for (let t = 0; t < rows.length; t += 1) {
    if (scheduled[t] <= 0) continue;
    let min = Number.POSITIVE_INFINITY;
    for (let u = t; u < rows.length; u += 1) {
      const adjusted = roundQty(rows[u].projectedOnHand - scheduled[t]);
      if (adjusted < min) min = adjusted;
    }
    if (min >= input.safetyStock) {
      exceptions.push({
        code: "EXCESS_RECEIPT",
        severity: "WARNING",
        weekStart: input.calendar.weekStarts[t],
        message:
          `${input.sku}: scheduled receipt of ${scheduled[t]} in week ${input.calendar.weekStarts[t]} ` +
          `is not needed to maintain safety stock; consider cancelling or pushing out`,
      });
    }
  }
}

function padTo(values: readonly number[], length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < Math.min(values.length, length); i += 1) out[i] = roundQty(values[i]);
  return out;
}
