import { nowIso } from "@enterprise-suite/shared-kernel";
import type { Lot } from "../domain/lot.js";
import type { StockBalance } from "../domain/stock-balance.js";
import type { Bin } from "../domain/warehouse.js";

/**
 * Allocation source ordering.
 *
 * FEFO (first-expired-first-out): balances whose lot expires soonest are
 * consumed first; lot-less / non-expiring stock goes last. Standard for
 * food, pharma, chemicals.
 *
 * FIFO (first-in-first-out): oldest lot receipt first (falling back to
 * balance creation time for un-lotted stock). Standard for everything else.
 *
 * Both strategies tie-break on bin pickSequence so pickers walk the shortest
 * path, then on balance id for deterministic output.
 */
export type AllocationStrategy = "FEFO" | "FIFO";

export const ALLOCATION_STRATEGIES: readonly AllocationStrategy[] = ["FEFO", "FIFO"];

export interface AllocationCandidate {
  readonly balance: StockBalance;
  readonly lot: Lot | null;
  readonly bin: Bin;
}

const FAR_FUTURE = "9999-12-31T23:59:59.999Z";

function expiryKey(candidate: AllocationCandidate): string {
  return candidate.lot?.expiresAt ?? FAR_FUTURE;
}

function receiptKey(candidate: AllocationCandidate): string {
  return candidate.lot?.receivedAt ?? candidate.balance.createdAt;
}

export function sortCandidates(
  strategy: AllocationStrategy,
  candidates: readonly AllocationCandidate[],
): AllocationCandidate[] {
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    const primary =
      strategy === "FEFO"
        ? expiryKey(a).localeCompare(expiryKey(b))
        : receiptKey(a).localeCompare(receiptKey(b));
    if (primary !== 0) return primary;
    const bySequence = a.bin.pickSequence - b.bin.pickSequence;
    if (bySequence !== 0) return bySequence;
    return String(a.balance.id).localeCompare(String(b.balance.id));
  });
  return sorted;
}

/**
 * Filter out sources that must never be allocated: blocked bins, unusable
 * (quarantined/expired/consumed) lots, and balances with nothing available.
 */
export function usableCandidates(
  candidates: readonly AllocationCandidate[],
): AllocationCandidate[] {
  const now = nowIso();
  return candidates.filter((c) => {
    if (c.balance.available <= 0) return false;
    if (!c.bin.isAvailable) return false;
    if (c.lot && !c.lot.isUsableAt(now)) return false;
    return true;
  });
}
