import { AggregateRoot, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
export type TaxScope = "SALES" | "PURCHASE" | "BOTH";
export interface TaxCodeProps {
    code: string;
    name: string;
    rateBps: number;
    scope: TaxScope;
    active: boolean;
}
export declare class TaxCode extends AggregateRoot<TaxCodeProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        code: string;
        name: string;
        rateBps: number;
        scope?: TaxScope;
    }): Result<TaxCode>;
    get code(): string;
    get name(): string;
    get rateBps(): number;
    get scope(): TaxScope;
    get active(): boolean;
    appliesTo(side: "SALES" | "PURCHASE"): boolean;
    deactivate(): Result<void>;
}
//# sourceMappingURL=tax-code.d.ts.map