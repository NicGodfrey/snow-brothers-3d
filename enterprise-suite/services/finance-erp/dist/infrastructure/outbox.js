/**
 * Transactional-outbox stand-in: events are appended in publish order and
 * fanned out synchronously to local subscribers. Integration-hub is expected
 * to drain the same log asynchronously in the real deployment.
 */
export class InMemoryOutbox {
    log = [];
    subscribers = new Set();
    publish(event) {
        this.log.push(event);
        for (const subscriber of this.subscribers) {
            subscriber(event);
        }
    }
    publishAll(events) {
        for (const event of events)
            this.publish(event);
    }
    subscribe(subscriber) {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }
    list(tenantId, eventType) {
        return this.log
            .filter((e) => !tenantId || e.tenantId === tenantId)
            .filter((e) => !eventType || e.eventType === eventType);
    }
}
//# sourceMappingURL=outbox.js.map