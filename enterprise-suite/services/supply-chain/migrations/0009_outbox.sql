-- Transactional outbox for domain events (shared-kernel envelope shape).
-- A relay publishes unpublished rows to the event bus and stamps published_at.

CREATE TABLE outbox_event (
    event_id       TEXT PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    event_type     TEXT        NOT NULL,
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,
    schema_version INTEGER     NOT NULL DEFAULT 1,
    payload        JSONB       NOT NULL,
    correlation_id TEXT,
    causation_id   TEXT,
    occurred_at    TIMESTAMPTZ NOT NULL,
    published_at   TIMESTAMPTZ
);

CREATE INDEX ix_outbox_unpublished ON outbox_event (occurred_at) WHERE published_at IS NULL;
CREATE INDEX ix_outbox_aggregate ON outbox_event (tenant_id, aggregate_type, aggregate_id);
