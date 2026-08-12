export interface PageRequest {
    readonly page: number;
    readonly pageSize: number;
    readonly cursor?: string;
}
export interface Page<T> {
    readonly items: readonly T[];
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly nextCursor?: string;
}
export declare function normalizePage(input?: Partial<PageRequest>): PageRequest;
export declare function paginate<T>(items: readonly T[], req: PageRequest): Page<T>;
//# sourceMappingURL=pagination.d.ts.map