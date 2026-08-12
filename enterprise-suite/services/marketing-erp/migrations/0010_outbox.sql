-- Transactional outbox for marketing domain events.
CREATE TABLE IF NOT EXISTS mkt_outbox_events (
    event_id       TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id   TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload        JSONB NOT NULL,
    correlation_id TEXT,
    causation_id   TEXT,
    occurred_at    TIMESTAMPTZ NOT NULL,
    dispatched_at  TIMESTAMPTZ
);

-- The relay scans for undelivered events in insertion order.
CREATE INDEX IF NOT EXISTS ix_mkt_outbox_pending
    ON mkt_outbox_events (occurred_at) WHERE dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mkt_outbox_aggregate
    ON mkt_outbox_events (aggregate_type, aggregate_id);
