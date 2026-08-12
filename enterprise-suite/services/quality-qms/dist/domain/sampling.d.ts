export type InspectionLevel = "I" | "II" | "III";
/** AQL values supported by this plan table (percent defective). */
export declare const SUPPORTED_AQLS: readonly [0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1, 1.5, 2.5, 4, 6.5];
export type AqlValue = (typeof SUPPORTED_AQLS)[number];
export type SamplingRule = {
    readonly kind: "full";
} | {
    readonly kind: "fixed";
    readonly sampleSize: number;
} | {
    readonly kind: "percentage";
    readonly percent: number;
    readonly minimum: number;
    readonly maximum?: number;
} | {
    readonly kind: "aql";
    readonly level: InspectionLevel;
    readonly aql: AqlValue;
};
export interface SamplingOutcome {
    /** Units to inspect. Never exceeds the lot quantity. */
    readonly sampleSize: number;
    /** Max defective units for an attribute characteristic to still accept. */
    readonly acceptanceNumber: number;
    /** Min defective units that force rejection (acceptanceNumber + 1). */
    readonly rejectionNumber: number;
    /** Human-readable description, persisted on the lot for traceability. */
    readonly description: string;
}
declare const CODE_LETTERS: readonly ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"];
type CodeLetter = (typeof CODE_LETTERS)[number];
export declare function codeLetterFor(lotSize: number, level: InspectionLevel): CodeLetter;
export declare function aqlSingleNormalPlan(lotSize: number, level: InspectionLevel, aql: AqlValue): {
    sampleSize: number;
    acceptanceNumber: number;
    codeLetter: CodeLetter;
};
export declare function determineSampling(rule: SamplingRule, lotQuantity: number): SamplingOutcome;
export declare function validateSamplingRule(rule: SamplingRule): void;
export {};
//# sourceMappingURL=sampling.d.ts.map