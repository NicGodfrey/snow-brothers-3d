-- quality-qms 0007: transactional outbox
--
-- Events are inserted in the same transaction as the aggregate write and
-- relayed to the event bus by integration-hub. dispatched_at IS NULL marks
-- pending rows; the partial index makes the relay poll cheap.

CREATE TABLE quality.outbox_event (
    event_id       TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    event_type     TEXT        NOT NULL,
    aggregate_type TEXT        NOT NULL,
    aggregate_id   TEXT        NOT NULL,
    occurred_at    TIMESTAMPTZ NOT NULL,
    schema_version INTEGER     NOT NULL DEFAULT 1,
    payload        JSONB       NOT NULL,
    correlation_id TEXT,
    causation_id   TEXT,
    dispatched_at  TIMESTAMPTZ,
    -- monotonically increasing relay cursor
    sequence       BIGINT      GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX outbox_pending_ix ON quality.outbox_event (sequence)
    WHERE dispatched_at IS NULL;
CREATE INDEX outbox_aggregate_ix ON quality.outbox_event (aggregate_type, aggregate_id);
