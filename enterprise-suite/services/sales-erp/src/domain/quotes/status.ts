import type { StateMachineDef } from "../../kernel/index.js";

export type QuoteStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "accepted"
  | "expired"
  | "cancelled";

/**
 * draft            -> pending_approval (submit), cancelled
 * pending_approval -> approved, rejected, cancelled
 * approved         -> accepted (customer), expired (validity sweep), cancelled
 * rejected/expired -> draft (revise: bumps revision)
 * accepted         terminal (order created from it)
 * cancelled        terminal
 */
export const QUOTE_STATUS_MACHINE: StateMachineDef<QuoteStatus> = {
  name: "Quote",
  initial: "draft",
  transitions: {
    draft: ["pending_approval", "cancelled"],
    pending_approval: ["approved", "rejected", "cancelled"],
    approved: ["accepted", "expired", "cancelled"],
    rejected: ["draft"],
    expired: ["draft"],
    accepted: [],
    cancelled: [],
  },
};

export const EDITABLE_QUOTE_STATUSES: readonly QuoteStatus[] = ["draft"];
