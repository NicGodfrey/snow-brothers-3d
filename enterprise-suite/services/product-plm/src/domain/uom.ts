import { brand, type Brand } from "@enterprise-suite/shared-kernel";
import { UomError } from "./errors.js";

/**
 * Units of measure.
 *
 * Every unit belongs to exactly one physical dimension and carries a factor to
 * that dimension's base unit (EA, KG, M, M2, L, HR). Conversion is only legal
 * within a dimension; cross-dimension conversion (e.g. KG -> M) is a hard
 * error, not a silent factor-1 pass-through.
 */

export type UomCode = Brand<string, "UomCode">;

export type UomDimension = "count" | "mass" | "length" | "area" | "volume" | "time";

export const UOM_DIMENSIONS: readonly UomDimension[] = [
  "count",
  "mass",
  "length",
  "area",
  "volume",
  "time",
];

export interface UnitOfMeasure {
  readonly code: UomCode;
  readonly name: string;
  readonly dimension: UomDimension;
  /** Multiplier converting 1 of this unit into the dimension's base unit. */
  readonly toBase: number;
  /** Decimal places quantities in this unit are rounded to (default 6). */
  readonly precision: number;
}

export function uomCode(value: string): UomCode {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,12}$/.test(normalized)) {
    throw new UomError(`Invalid UoM code: "${value}"`);
  }
  return brand<string, "UomCode">(normalized);
}

function unit(
  code: string,
  name: string,
  dimension: UomDimension,
  toBase: number,
  precision = 6,
): UnitOfMeasure {
  return { code: uomCode(code), name, dimension, toBase, precision };
}

/** Units available to every tenant out of the box. */
export const STANDARD_UNITS: readonly UnitOfMeasure[] = [
  unit("EA", "Each", "count", 1, 0),
  // Pack units keep two decimals: 25 EA is a meaningful 2.08 DZ.
  unit("PR", "Pair", "count", 2, 2),
  unit("DZ", "Dozen", "count", 12, 2),
  unit("KG", "Kilogram", "mass", 1),
  unit("G", "Gram", "mass", 0.001),
  unit("MG", "Milligram", "mass", 0.000001),
  unit("T", "Metric ton", "mass", 1000),
  unit("LB", "Pound", "mass", 0.45359237),
  unit("OZ", "Ounce", "mass", 0.028349523125),
  unit("M", "Meter", "length", 1),
  unit("MM", "Millimeter", "length", 0.001),
  unit("CM", "Centimeter", "length", 0.01),
  unit("KM", "Kilometer", "length", 1000),
  unit("IN", "Inch", "length", 0.0254),
  unit("FT", "Foot", "length", 0.3048),
  unit("M2", "Square meter", "area", 1),
  unit("CM2", "Square centimeter", "area", 0.0001),
  unit("FT2", "Square foot", "area", 0.09290304),
  unit("L", "Liter", "volume", 1),
  unit("ML", "Milliliter", "volume", 0.001),
  unit("M3", "Cubic meter", "volume", 1000),
  unit("GAL", "US gallon", "volume", 3.785411784),
  unit("HR", "Hour", "time", 1),
  unit("MIN", "Minute", "time", 1 / 60),
  unit("SEC", "Second", "time", 1 / 3600),
];

/** A measured amount. Immutable; all math returns new quantities. */
export interface Quantity {
  readonly value: number;
  readonly uom: UomCode;
}

export function qty(value: number, uom: UomCode): Quantity {
  if (!Number.isFinite(value)) throw new UomError("Quantity must be a finite number");
  return { value, uom };
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * A closed set of units used for conversion. The registry is assembled per
 * tenant (standard units plus tenant-defined ones) so custom units never leak
 * across tenants.
 */
export class UomRegistry {
  private readonly units = new Map<string, UnitOfMeasure>();

  constructor(units: readonly UnitOfMeasure[] = STANDARD_UNITS) {
    for (const u of units) this.register(u);
  }

  register(u: UnitOfMeasure): void {
    if (this.units.has(u.code)) {
      throw new UomError(`UoM already registered: ${u.code}`);
    }
    if (!(u.toBase > 0)) {
      throw new UomError(`UoM ${u.code} must have a positive base factor`);
    }
    if (!UOM_DIMENSIONS.includes(u.dimension)) {
      throw new UomError(`UoM ${u.code} has unknown dimension "${u.dimension}"`);
    }
    this.units.set(u.code, u);
  }

  has(code: string): boolean {
    return this.units.has(code.trim().toUpperCase());
  }

  resolve(code: UomCode | string): UnitOfMeasure {
    const found = this.units.get(String(code).trim().toUpperCase());
    if (!found) throw new UomError(`Unknown unit of measure: ${String(code)}`);
    return found;
  }

  all(): readonly UnitOfMeasure[] {
    return [...this.units.values()];
  }

  sameDimension(a: UomCode | string, b: UomCode | string): boolean {
    return this.resolve(a).dimension === this.resolve(b).dimension;
  }

  convert(value: number, from: UomCode | string, to: UomCode | string): number {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (source.dimension !== target.dimension) {
      throw new UomError(
        `Cannot convert ${source.code} (${source.dimension}) to ${target.code} (${target.dimension})`,
      );
    }
    return roundTo((value * source.toBase) / target.toBase, target.precision);
  }

  convertQty(quantity: Quantity, to: UomCode | string): Quantity {
    return qty(this.convert(quantity.value, quantity.uom, to), this.resolve(to).code);
  }

  /** Adds two quantities, expressing the result in `a`'s unit. */
  addQty(a: Quantity, b: Quantity): Quantity {
    const converted = this.convertQty(b, a.uom);
    return qty(roundTo(a.value + converted.value, this.resolve(a.uom).precision), a.uom);
  }

  scaleQty(a: Quantity, factor: number): Quantity {
    if (!Number.isFinite(factor)) throw new UomError("Scale factor must be finite");
    return qty(roundTo(a.value * factor, this.resolve(a.uom).precision), a.uom);
  }
}
