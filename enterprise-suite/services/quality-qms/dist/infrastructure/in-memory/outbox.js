export class InMemoryOutbox {
    records = [];
    async append(events) {
        for (const event of events) {
            this.records.push({ event, dispatched: false });
        }
    }
    async drain() {
        const pending = this.records.filter((r) => !r.dispatched);
        for (const record of pending)
            record.dispatched = true;
        return pending.map((r) => r.event);
    }
    async pending() {
        return this.records.filter((r) => !r.dispatched).map((r) => r.event);
    }
    /** All events ever appended (test/diagnostic helper). */
    all() {
        return this.records.map((r) => r.event);
    }
}
//# sourceMappingURL=outbox.js.map