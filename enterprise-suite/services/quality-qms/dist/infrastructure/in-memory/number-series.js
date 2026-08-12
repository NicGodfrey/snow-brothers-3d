export class InMemoryNumberSeries {
    clock;
    counters = new Map();
    constructor(clock) {
        this.clock = clock;
    }
    async next(tenantId, seriesCode) {
        const year = new Date(this.clock.now()).getUTCFullYear();
        const key = `${tenantId}:${seriesCode}:${year}`;
        const next = (this.counters.get(key) ?? 0) + 1;
        this.counters.set(key, next);
        return `${seriesCode}-${year}-${String(next).padStart(6, "0")}`;
    }
}
//# sourceMappingURL=number-series.js.map