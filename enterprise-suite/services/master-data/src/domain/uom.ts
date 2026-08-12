import { brand, type Brand } from "@enterprise-suite/shared-kernel";
import { UomError } from "./errors.js";

/**
 * Units of measure and conversion.
 *
 * Two kinds of conversion exist and they behave differently:
 *
 * - Dimensional conversion (KG -> LB) is universal. Every unit carries a
 *   factor to its dimension's base unit, plus an offset for the affine scales
 *   (°C/°F), which is why conversion is `value * toBase + offset`, not a bare
 *   multiplication.
 * - Item conversion (CASE -> EA, EA -> KG) is not universal: a case holds 24
 *   of one product and 6 of another. Those live as directed edges keyed by
 *   product, and `UomConverter` walks them to bridge dimensions.
 */

export type UomCode = Brand<string, "UomCode">;

export type UomDimension =
  | "count"
  | "mass"
  | "length"
  | "area"
  | "volume"
  | "time"
  | "temperature"
  | "energy";

export const UOM_DIMENSIONS: readonly UomDimension[] = [
  "count",
  "mass",
  "length",
  "area",
  "volume",
  "time",
  "temperature",
  "energy",
];

export interface UnitOfMeasure {
  readonly code: UomCode;
  readonly name: string;
  readonly symbol: string;
  readonly dimension: UomDimension;
  /** Multiplier converting one of this unit into the dimension's base unit. */
  readonly toBase: number;
  /** Additive term applied after scaling; non-zero only for temperature. */
  readonly offset: number;
  /** Decimal places quantities in this unit round to. */
  readonly precision: number;
  /** Standard units ship with the product; tenant units are created at runtime. */
  readonly isStandard: boolean;
}

export function uomCode(value: string): UomCode {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,16}$/.test(normalized)) {
    throw new UomError(`Invalid UoM code: "${value}"`);
  }
  return brand<string, "UomCode">(normalized);
}

function unit(
  code: string,
  name: string,
  symbol: string,
  dimension: UomDimension,
  toBase: number,
  precision = 6,
  offset = 0,
): UnitOfMeasure {
  return {
    code: uomCode(code),
    name,
    symbol,
    dimension,
    toBase,
    offset,
    precision,
    isStandard: true,
  };
}

/** Base unit per dimension; every factor in the table refers back to these. */
export const BASE_UNITS: Readonly<Record<UomDimension, string>> = {
  count: "EA",
  mass: "KG",
  length: "M",
  area: "M2",
  volume: "L",
  time: "HR",
  temperature: "K",
  energy: "KWH",
};

export const STANDARD_UNITS: readonly UnitOfMeasure[] = [
  unit("EA", "Each", "ea", "count", 1, 0),
  unit("PR", "Pair", "pr", "count", 2, 2),
  unit("DZ", "Dozen", "dz", "count", 12, 2),
  unit("HUN", "Hundred", "C", "count", 100, 2),
  unit("THO", "Thousand", "M", "count", 1000, 3),

  unit("KG", "Kilogram", "kg", "mass", 1),
  unit("G", "Gram", "g", "mass", 0.001),
  unit("MG", "Milligram", "mg", "mass", 0.000001),
  unit("T", "Metric ton", "t", "mass", 1000),
  unit("LB", "Pound", "lb", "mass", 0.45359237),
  unit("OZ", "Ounce", "oz", "mass", 0.028349523125),
  unit("ST", "Short ton", "ton", "mass", 907.18474),

  unit("M", "Meter", "m", "length", 1),
  unit("MM", "Millimeter", "mm", "length", 0.001),
  unit("CM", "Centimeter", "cm", "length", 0.01),
  unit("KM", "Kilometer", "km", "length", 1000),
  unit("IN", "Inch", "in", "length", 0.0254),
  unit("FT", "Foot", "ft", "length", 0.3048),
  unit("YD", "Yard", "yd", "length", 0.9144),
  unit("MI", "Mile", "mi", "length", 1609.344),

  unit("M2", "Square meter", "m²", "area", 1),
  unit("CM2", "Square centimeter", "cm²", "area", 0.0001),
  unit("FT2", "Square foot", "ft²", "area", 0.09290304),
  unit("HA", "Hectare", "ha", "area", 10000),

  unit("L", "Liter", "L", "volume", 1),
  unit("ML", "Milliliter", "mL", "volume", 0.001),
  unit("M3", "Cubic meter", "m³", "volume", 1000),
  unit("CM3", "Cubic centimeter", "cm³", "volume", 0.001),
  unit("GAL", "US gallon", "gal", "volume", 3.785411784),
  unit("QT", "US quart", "qt", "volume", 0.946352946),
  unit("FLOZ", "US fluid ounce", "fl oz", "volume", 0.0295735295625),
  unit("FT3", "Cubic foot", "ft³", "volume", 28.316846592),

  unit("HR", "Hour", "h", "time", 1),
  unit("MIN", "Minute", "min", "time", 1 / 60),
  unit("SEC", "Second", "s", "time", 1 / 3600),
  unit("DAY", "Day", "d", "time", 24),
  unit("WK", "Week", "wk", "time", 168),

  unit("K", "Kelvin", "K", "temperature", 1, 4),
  unit("C", "Degree Celsius", "°C", "temperature", 1, 4, 273.15),
  unit("F", "Degree Fahrenheit", "°F", "temperature", 5 / 9, 4, 255.372222222222),

  unit("KWH", "Kilowatt hour", "kWh", "energy", 1),
  unit("WH", "Watt hour", "Wh", "energy", 0.001),
  unit("MJ", "Megajoule", "MJ", "energy", 0.2777777777777778),
  unit("BTU", "British thermal unit", "BTU", "energy", 0.00029307107),
];

export interface Quantity {
  readonly value: number;
  readonly uom: UomCode;
}

export function qty(value: number, uom: UomCode | string): Quantity {
  if (!Number.isFinite(value)) throw new UomError("Quantity must be a finite number");
  return { value, uom: typeof uom === "string" ? uomCode(uom) : uom };
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value || 1)) * factor) / factor;
}

/** Rounds a quantity up/down/nearest to a packaging or order multiple. */
export function roundToIncrement(
  value: number,
  increment: number,
  mode: "up" | "down" | "nearest" = "nearest",
): number {
  if (!(increment > 0)) throw new UomError("Increment must be positive");
  const steps = value / increment;
  const rounded =
    mode === "up" ? Math.ceil(steps - 1e-9) : mode === "down" ? Math.floor(steps + 1e-9) : Math.round(steps);
  return roundTo(rounded * increment, 6);
}

/**
 * A closed set of units. Assembled per tenant (standard units plus the
 * tenant's own) so a custom unit can never leak into another tenant's
 * conversions.
 */
export class UomRegistry {
  private readonly units = new Map<string, UnitOfMeasure>();

  constructor(units: readonly UnitOfMeasure[] = STANDARD_UNITS) {
    for (const u of units) this.register(u);
  }

  register(u: UnitOfMeasure): void {
    if (this.units.has(String(u.code))) {
      throw new UomError(`UoM already registered: ${u.code}`);
    }
    if (!(u.toBase > 0)) {
      throw new UomError(`UoM ${u.code} must have a positive base factor`);
    }
    if (!UOM_DIMENSIONS.includes(u.dimension)) {
      throw new UomError(`UoM ${u.code} has unknown dimension "${u.dimension}"`);
    }
    this.units.set(String(u.code), u);
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
    return [...this.units.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  inDimension(dimension: UomDimension): readonly UnitOfMeasure[] {
    return this.all().filter((u) => u.dimension === dimension);
  }

  baseUnit(dimension: UomDimension): UnitOfMeasure {
    return this.resolve(BASE_UNITS[dimension]);
  }

  sameDimension(a: UomCode | string, b: UomCode | string): boolean {
    return this.resolve(a).dimension === this.resolve(b).dimension;
  }

  /** True when the unit needs affine conversion and cannot be used as a ratio. */
  isAffine(code: UomCode | string): boolean {
    return this.resolve(code).offset !== 0;
  }

  /**
   * Converts within a dimension. Temperature goes through the base scale with
   * its offset applied; every other dimension is a plain ratio.
   */
  convert(value: number, from: UomCode | string, to: UomCode | string): number {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (source.dimension !== target.dimension) {
      throw new UomError(
        `Cannot convert ${source.code} (${source.dimension}) to ${target.code} (${target.dimension})`,
      );
    }
    const inBase = value * source.toBase + source.offset;
    return roundTo((inBase - target.offset) / target.toBase, target.precision);
  }

  /**
   * Pure multiplicative factor between two units of the same dimension.
   * Rejects affine units, where no single factor exists.
   */
  ratio(from: UomCode | string, to: UomCode | string): number {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (source.dimension !== target.dimension) {
      throw new UomError(`Cannot ratio ${source.code} against ${target.code}: different dimensions`);
    }
    if (source.offset !== 0 || target.offset !== 0) {
      throw new UomError(
        `${source.code}/${target.code} is an affine scale; use convert() instead of a ratio`,
      );
    }
    return source.toBase / target.toBase;
  }

  convertQty(quantity: Quantity, to: UomCode | string): Quantity {
    return qty(this.convert(quantity.value, quantity.uom, to), this.resolve(to).code);
  }

  /** Adds two quantities, expressing the result in `a`'s unit. */
  addQty(a: Quantity, b: Quantity): Quantity {
    const converted = this.convertQty(b, a.uom);
    return qty(roundTo(a.value + converted.value, this.resolve(a.uom).precision), a.uom);
  }

  subtractQty(a: Quantity, b: Quantity): Quantity {
    const converted = this.convertQty(b, a.uom);
    return qty(roundTo(a.value - converted.value, this.resolve(a.uom).precision), a.uom);
  }

  scaleQty(a: Quantity, factor: number): Quantity {
    if (!Number.isFinite(factor)) throw new UomError("Scale factor must be finite");
    return qty(roundTo(a.value * factor, this.resolve(a.uom).precision), a.uom);
  }

  compareQty(a: Quantity, b: Quantity): number {
    const converted = this.convertQty(b, a.uom);
    return a.value === converted.value ? 0 : a.value < converted.value ? -1 : 1;
  }
}

/** Wildcard product key for conversions that apply to the whole catalog. */
export const ALL_PRODUCTS = "*";

/**
 * A directed conversion that dimensional maths cannot derive: how many `to`
 * units one `from` unit represents, optionally only for one product.
 */
export interface UomConversion {
  readonly productCode: string;
  readonly from: UomCode;
  readonly to: UomCode;
  readonly factor: number;
  readonly note?: string;
}

export interface ConversionStep {
  readonly from: UomCode;
  readonly to: UomCode;
  readonly factor: number;
  readonly kind: "dimensional" | "item";
  readonly productCode?: string;
}

export interface ConversionResult {
  readonly value: number;
  readonly from: UomCode;
  readonly to: UomCode;
  readonly factor: number;
  readonly steps: readonly ConversionStep[];
}

export function conversionKey(productCode: string, from: string, to: string): string {
  return `${productCode.toUpperCase()}|${from.toUpperCase()}>${to.toUpperCase()}`;
}

/**
 * Converts across dimensions by walking item conversions.
 *
 * The search is a breadth-first walk over item conversion edges, where each
 * hop may be preceded by a free dimensional conversion (any unit converts to
 * any sibling unit in its dimension). Breadth-first means the answer uses the
 * fewest item conversions available, and product-specific edges shadow the
 * catalog-wide ones for the same pair.
 */
export class UomConverter {
  private readonly edges: UomConversion[];

  constructor(
    private readonly registry: UomRegistry,
    conversions: readonly UomConversion[] = [],
  ) {
    this.edges = conversions.map((c) => ({ ...c, productCode: c.productCode.toUpperCase() }));
  }

  /** Item conversions visible for a product: its own, then catalog-wide ones. */
  edgesFor(productCode?: string): readonly UomConversion[] {
    const product = productCode?.toUpperCase();
    const relevant = this.edges.filter(
      (edge) => edge.productCode === ALL_PRODUCTS || (product !== undefined && edge.productCode === product),
    );
    const seen = new Set<string>();
    const ordered = [
      ...relevant.filter((edge) => edge.productCode !== ALL_PRODUCTS),
      ...relevant.filter((edge) => edge.productCode === ALL_PRODUCTS),
    ];
    return ordered.filter((edge) => {
      const key = `${edge.from}>${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  convert(
    value: number,
    from: UomCode | string,
    to: UomCode | string,
    productCode?: string,
  ): ConversionResult {
    const source = this.registry.resolve(from);
    const target = this.registry.resolve(to);

    if (source.dimension === target.dimension) {
      return {
        value: this.registry.convert(value, source.code, target.code),
        from: source.code,
        to: target.code,
        factor: source.offset === 0 && target.offset === 0 ? this.registry.ratio(source.code, target.code) : Number.NaN,
        steps: [
          {
            from: source.code,
            to: target.code,
            factor: source.offset === 0 && target.offset === 0 ? this.registry.ratio(source.code, target.code) : Number.NaN,
            kind: "dimensional",
          },
        ],
      };
    }

    const path = this.findPath(source, target, productCode);
    if (!path) {
      throw new UomError(
        `No conversion from ${source.code} to ${target.code}${
          productCode ? ` for product ${productCode}` : ""
        }: define an item conversion`,
        { from: String(source.code), to: String(target.code), productCode },
      );
    }
    const factor = path.reduce((acc, step) => acc * step.factor, 1);
    return {
      value: roundTo(value * factor, target.precision),
      from: source.code,
      to: target.code,
      factor,
      steps: path,
    };
  }

  factor(from: UomCode | string, to: UomCode | string, productCode?: string): number {
    return this.convert(1, from, to, productCode).factor;
  }

  canConvert(from: UomCode | string, to: UomCode | string, productCode?: string): boolean {
    try {
      this.convert(1, from, to, productCode);
      return true;
    } catch {
      return false;
    }
  }

  private findPath(
    source: UnitOfMeasure,
    target: UnitOfMeasure,
    productCode?: string,
  ): ConversionStep[] | undefined {
    const edges = this.edgesFor(productCode);
    if (edges.length === 0) return undefined;

    const visited = new Set<UomDimension>([source.dimension]);
    const queue: Array<{ unit: UnitOfMeasure; steps: ConversionStep[] }> = [
      { unit: source, steps: [] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        const edgeFrom = this.registry.resolve(edge.from);
        const edgeTo = this.registry.resolve(edge.to);
        for (const [entry, exit, factor] of [
          [edgeFrom, edgeTo, edge.factor],
          [edgeTo, edgeFrom, 1 / edge.factor],
        ] as const) {
          if (entry.dimension !== current.unit.dimension) continue;
          if (visited.has(exit.dimension)) continue;
          if (entry.offset !== 0 || exit.offset !== 0) continue; // affine scales never bridge

          const steps: ConversionStep[] = [...current.steps];
          if (String(current.unit.code) !== String(entry.code)) {
            steps.push({
              from: current.unit.code,
              to: entry.code,
              factor: this.registry.ratio(current.unit.code, entry.code),
              kind: "dimensional",
            });
          }
          steps.push({
            from: entry.code,
            to: exit.code,
            factor,
            kind: "item",
            productCode: edge.productCode,
          });

          if (exit.dimension === target.dimension) {
            if (String(exit.code) !== String(target.code)) {
              steps.push({
                from: exit.code,
                to: target.code,
                factor: this.registry.ratio(exit.code, target.code),
                kind: "dimensional",
              });
            }
            return steps;
          }
          visited.add(exit.dimension);
          queue.push({ unit: exit, steps });
        }
      }
    }
    return undefined;
  }
}
