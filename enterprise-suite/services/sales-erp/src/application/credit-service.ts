import { addMoney, zeroMoney, type Money, type TenantContext, type Ulid } from "../kernel/index.js";
import { checkCredit, type CreditCheckResult } from "../domain/accounts/credit-policy.js";
import type { SalesOrder } from "../domain/orders/sales-order.js";
import type { AccountRepository, SalesOrderRepository } from "./ports.js";

/**
 * Computes an account's live credit exposure from its open orders and runs
 * the credit policy against it. Used at order confirmation and exposed via
 * HTTP for "what-if" checks.
 */
export class CreditService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly orders: SalesOrderRepository,
  ) {}

  openExposure(ctx: TenantContext, accountId: Ulid, excludeOrderId?: Ulid): Money {
    const account = this.accounts.getById(ctx.tenantId, accountId);
    const open = this.orders
      .listOpenExposure(ctx.tenantId, accountId)
      .filter((o: SalesOrder) => o.id !== excludeOrderId);
    return open.reduce(
      (acc, order) => addMoney(acc, order.totals().grandTotal),
      zeroMoney(account.currencyCode),
    );
  }

  check(ctx: TenantContext, accountId: Ulid, orderTotal: Money, excludeOrderId?: Ulid): CreditCheckResult {
    const account = this.accounts.getById(ctx.tenantId, accountId);
    const exposure = this.openExposure(ctx, accountId, excludeOrderId);
    return checkCredit(account, exposure, orderTotal);
  }
}
