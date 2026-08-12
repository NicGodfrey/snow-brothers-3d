/**
 * Shared body-to-command parsers used by several route modules.
 */
import { DomainError } from "@enterprise-suite/shared-kernel";
import type { CharacteristicInput } from "../../domain/inspection-plan.js";
import { SUPPORTED_AQLS, type AqlValue, type SamplingRule } from "../../domain/sampling.js";
import {
  asObject,
  optionalNumber,
  optionalString,
  requireEnum,
  requireNumber,
  requireString,
} from "../validation.js";

export function parseSamplingRule(raw: unknown): SamplingRule {
  const obj = asObject(raw, "samplingRule");
  const kind = requireEnum(obj, "kind", ["full", "fixed", "percentage", "aql"] as const);
  switch (kind) {
    case "full":
      return { kind };
    case "fixed":
      return { kind, sampleSize: requireNumber(obj, "sampleSize") };
    case "percentage":
      return {
        kind,
        percent: requireNumber(obj, "percent"),
        minimum: requireNumber(obj, "minimum"),
        maximum: optionalNumber(obj, "maximum"),
      };
    case "aql": {
      const aql = requireNumber(obj, "aql");
      if (!SUPPORTED_AQLS.includes(aql as AqlValue)) {
        throw new DomainError(`'aql' must be one of: ${SUPPORTED_AQLS.join(", ")}`, "VALIDATION");
      }
      return {
        kind,
        level: requireEnum(obj, "level", ["I", "II", "III"] as const),
        aql: aql as AqlValue,
      };
    }
  }
}

export function parseCharacteristic(raw: Record<string, unknown>): CharacteristicInput {
  const type = requireEnum(raw, "type", ["quantitative", "attribute"] as const);
  const input: CharacteristicInput = {
    code: requireString(raw, "code"),
    name: requireString(raw, "name"),
    type,
    criticality: requireEnum(raw, "criticality", ["critical", "major", "minor"] as const),
    method: optionalString(raw, "method"),
    sampleSizeOverride: optionalNumber(raw, "sampleSizeOverride"),
  };
  if (type === "quantitative") {
    const spec = asObject(raw["quantitative"], "quantitative");
    return {
      ...input,
      quantitative: {
        unit: requireString(spec, "unit"),
        target: optionalNumber(spec, "target"),
        lowerLimit: optionalNumber(spec, "lowerLimit"),
        upperLimit: optionalNumber(spec, "upperLimit"),
        decimals: optionalNumber(spec, "decimals"),
      },
    };
  }
  return input;
}
