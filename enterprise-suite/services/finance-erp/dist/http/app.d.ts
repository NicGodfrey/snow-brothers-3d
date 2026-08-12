import { AccountService } from "../application/account-service.js";
import { AllocationService } from "../application/allocation-service.js";
import { ApService } from "../application/ap-service.js";
import { ArService } from "../application/ar-service.js";
import { CostCenterService } from "../application/cost-center-service.js";
import { FxService } from "../application/fx-service.js";
import { JournalService } from "../application/journal-service.js";
import { PeriodCloseService } from "../application/period-close-service.js";
import { PeriodService } from "../application/period-service.js";
import { LedgerSettingsService } from "../application/settings-service.js";
import { TaxService } from "../application/tax-service.js";
import { TrialBalanceService } from "../application/trial-balance-service.js";
import { type EventOutbox } from "../infrastructure/outbox.js";
import { Router } from "./router.js";
export interface FinanceApp {
    readonly router: Router;
    readonly outbox: EventOutbox;
    readonly services: {
        accounts: AccountService;
        journals: JournalService;
        periods: PeriodService;
        periodClose: PeriodCloseService;
        ar: ArService;
        ap: ApService;
        costCenters: CostCenterService;
        allocations: AllocationService;
        tax: TaxService;
        fx: FxService;
        trialBalance: TrialBalanceService;
        settings: LedgerSettingsService;
    };
}
/**
 * Wires repositories, services and HTTP routes together. Everything is
 * in-memory; swapping the repository constructors for Postgres adapters is
 * the only change needed for durable storage.
 */
export declare function createFinanceApp(): FinanceApp;
//# sourceMappingURL=app.d.ts.map