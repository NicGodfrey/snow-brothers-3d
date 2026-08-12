-- Transactional outbox for mes.* domain events.
-- Rows are inserted in the same transaction as the aggregate change; a
-- relay polls undispatched rows and hands them to integration-hub.

CREATE TABLE mes_outbox (
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

CREATE INDEX ix_mes_outbox_undispatched
    ON mes_outbox (occurred_at)
    WHERE dispatched_at IS NULL;
CREATE INDEX ix_mes_outbox_aggregate
    ON mes_outbox (tenant_id, aggregate_type, aggregate_id);

COMMENT ON TABLE mes_outbox IS
    'Mirror of the shared-kernel EventEnvelope; the in-memory adapter is infrastructure/outbox.ts';
