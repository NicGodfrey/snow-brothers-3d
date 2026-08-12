import type { CharacteristicInput } from "../../domain/inspection-plan.js";
import { type SamplingRule } from "../../domain/sampling.js";
export declare function parseSamplingRule(raw: unknown): SamplingRule;
export declare function parseCharacteristic(raw: Record<string, unknown>): CharacteristicInput;
//# sourceMappingURL=parsers.d.ts.map