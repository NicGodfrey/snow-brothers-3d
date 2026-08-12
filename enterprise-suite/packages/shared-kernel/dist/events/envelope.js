import { newId, nowIso } from "../types/branded.js";
export function envelope(input) {
    return {
        eventId: newId("evt"),
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        tenantId: input.tenantId,
        occurredAt: nowIso(),
        schemaVersion: input.schemaVersion ?? 1,
        payload: input.payload,
        correlationId: input.correlationId,
        causationId: input.causationId,
    };
}
//# sourceMappingURL=envelope.js.map