/**
 * In-memory stand-in for a transactional outbox. Services publish events
 * after saving aggregates; the outbox keeps them (for polling relays /
 * integration-hub) and fans them out to local subscribers synchronously.
 *
 * The Postgres version writes rows in the aggregate's transaction and a
 * relay marks them dispatched — see migrations/0009_outbox.sql.
 */
export class InMemoryOutbox {
    entries = [];
    subscribers = new Map();
    async publish(events) {
        for (const event of events) {
            this.entries.push(event);
            for (const [pattern, handlers] of this.subscribers) {
                if (event.eventType === pattern || event.eventType.startsWith(`${pattern}`)) {
                    for (const handler of handlers)
                        handler(event);
                }
            }
        }
    }
    /** Subscribe to an exact eventType or a prefix like "mes.work-order.". */
    subscribe(pattern, handler) {
        const handlers = this.subscribers.get(pattern) ?? [];
        handlers.push(handler);
        this.subscribers.set(pattern, handlers);
        return () => {
            const current = this.subscribers.get(pattern) ?? [];
            this.subscribers.set(pattern, current.filter((h) => h !== handler));
        };
    }
    /** All stored events, oldest first. */
    all() {
        return this.entries;
    }
    ofType(eventType) {
        return this.entries.filter((e) => e.eventType === eventType);
    }
    /** Remove and return everything — what a dispatch relay would do. */
    drain() {
        return this.entries.splice(0, this.entries.length);
    }
}
//# sourceMappingURL=outbox.js.map