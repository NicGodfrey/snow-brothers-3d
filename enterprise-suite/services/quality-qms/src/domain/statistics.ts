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
  readonly stdDev: number | null; // null when count < 2
  readonly cp: number | null;
  readonly cpk: number | null;
  readonly outOfSpecCount: number;
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export function computeStatistics(
  readings: readonly number[],
  lowerLimit?: number,
  upperLimit?: number,
): ReadingStatistics {
  if (readings.length === 0) {
    throw new Error("Cannot compute statistics over zero readings");
  }
  const count = readings.length;
  const mean = readings.reduce((a, b) => a + b, 0) / count;
  const min = Math.min(...readings);
  const max = Math.max(...readings);

  let stdDev: number | null = null;
  if (count >= 2) {
    const variance = readings.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (count - 1);
    stdDev = Math.sqrt(variance);
  }

  let cp: number | null = null;
  let cpk: number | null = null;
  if (stdDev !== null && stdDev > 0) {
    if (lowerLimit !== undefined && upperLimit !== undefined) {
      cp = (upperLimit - lowerLimit) / (6 * stdDev);
    }
    const cpu = upperLimit !== undefined ? (upperLimit - mean) / (3 * stdDev) : null;
    const cpl = lowerLimit !== undefined ? (mean - lowerLimit) / (3 * stdDev) : null;
    if (cpu !== null && cpl !== null) cpk = Math.min(cpu, cpl);
    else cpk = cpu ?? cpl;
  }

  const outOfSpecCount = readings.filter(
    (r) =>
      (lowerLimit !== undefined && r < lowerLimit) ||
      (upperLimit !== undefined && r > upperLimit),
  ).length;

  return {
    count,
    mean: round4(mean),
    min,
    max,
    range: round4(max - min),
    stdDev: stdDev === null ? null : round4(stdDev),
    cp: cp === null ? null : round4(cp),
    cpk: cpk === null ? null : round4(cpk),
    outOfSpecCount,
  };
}
