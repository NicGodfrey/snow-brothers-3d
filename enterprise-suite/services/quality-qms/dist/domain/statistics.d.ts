/**
 * SPC-style statistics computed over quantitative characteristic readings.
 *
 * Cp / Cpk use the sample standard deviation (n-1). Cpk needs at least one
 * spec limit; Cp needs both. Values are rounded to 4 decimals so they are
 * stable in API responses and test assertions.
 */
export interface ReadingStatistics {
    readonly count: number;
    readonly mean: number;
    readonly min: number;
    readonly max: number;
    readonly range: number;
    readonly stdDev: number | null;
    readonly cp: number | null;
    readonly cpk: number | null;
    readonly outOfSpecCount: number;
}
export declare function computeStatistics(readings: readonly number[], lowerLimit?: number, upperLimit?: number): ReadingStatistics;
//# sourceMappingURL=statistics.d.ts.map