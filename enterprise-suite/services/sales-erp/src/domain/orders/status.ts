import type { StateMachineDef } from "../../kernel/index.js";

export type OrderStatus =
  | "draft"
  | "confirmed"
  | "allocated"
  | "shipped"
  | "invoiced"
  | "closed"
  | "cancelled";

/**
 * draft -> confirmed -> allocated -> shipped -> invoiced -> closed
 * Cancellation is possible until goods have shipped.
 */
export const ORDER_STATUS_MACHINE: StateMachineDef<OrderStatus> = {
  name: "SalesOrder",
  initial: "draft",
  transitions: {
    draft: ["confirmed", "cancelled"],
    confirmed: ["allocated", "cancelled"],
    allocated: ["shipped", "cancelled"],
    shipped: ["invoiced"],
    invoiced: ["closed"],
    closed: [],
    cancelled: [],
  },
};

export const CANCELLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "draft",
  "confirmed",
  "allocated",
];
