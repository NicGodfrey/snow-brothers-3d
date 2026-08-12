const round4 = (v) => Math.round(v * 10_000) / 10_000;
export function computeStatistics(readings, lowerLimit, upperLimit) {
    if (readings.length === 0) {
        throw new Error("Cannot compute statistics over zero readings");
    }
    const count = readings.length;
    const mean = readings.reduce((a, b) => a + b, 0) / count;
    const min = Math.min(...readings);
    const max = Math.max(...readings);
    let stdDev = null;
    if (count >= 2) {
        const variance = readings.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (count - 1);
        stdDev = Math.sqrt(variance);
    }
    let cp = null;
    let cpk = null;
    if (stdDev !== null && stdDev > 0) {
        if (lowerLimit !== undefined && upperLimit !== undefined) {
            cp = (upperLimit - lowerLimit) / (6 * stdDev);
        }
        const cpu = upperLimit !== undefined ? (upperLimit - mean) / (3 * stdDev) : null;
        const cpl = lowerLimit !== undefined ? (mean - lowerLimit) / (3 * stdDev) : null;
        if (cpu !== null && cpl !== null)
            cpk = Math.min(cpu, cpl);
        else
            cpk = cpu ?? cpl;
    }
    const outOfSpecCount = readings.filter((r) => (lowerLimit !== undefined && r < lowerLimit) ||
        (upperLimit !== undefined && r > upperLimit)).length;
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
//# sourceMappingURL=statistics.js.map