/**
 * In-memory stand-in for the transactional outbox. Events are appended in
 * publish order and fanned out synchronously to subscribers (e.g. the shared
 * event bus adapter, projections, tests).
 */
export class InMemoryOutbox {
    log = [];
    subscribers = [];
    async publish(events) {
        for (const event of events) {
            this.log.push(event);
            for (const subscriber of this.subscribers)
                subscriber(event);
        }
    }
    subscribe(subscriber) {
        this.subscribers.push(subscriber);
        return () => {
            const index = this.subscribers.indexOf(subscriber);
            if (index >= 0)
                this.subscribers.splice(index, 1);
        };
    }
    events() {
        return this.log;
    }
    eventsOfType(eventType) {
        return this.log.filter((e) => e.eventType === eventType);
    }
}
//# sourceMappingURL=outbox.js.map